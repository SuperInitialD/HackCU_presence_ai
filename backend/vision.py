"""
vision.py — Server-side face analysis using MediaPipe FaceMesh.

Exposes a single public function:
    analyze_frame(image_bytes: bytes) -> dict

The FaceMesh model is initialised once at import time as a module-level
singleton so the cost of loading the model is paid only on startup, not
per-request.
"""

import math
import numpy as np
import cv2
import mediapipe as mp

# ──────────────────────────────────────────────────────────────────────────────
# Singleton FaceMesh — created once, reused across every request
# ──────────────────────────────────────────────────────────────────────────────

_face_mesh = mp.solutions.face_mesh.FaceMesh(
    static_image_mode=True,       # we get individual frames, not video
    max_num_faces=1,
    refine_landmarks=True,        # enables iris landmarks (468, 473, …)
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
)

# ──────────────────────────────────────────────────────────────────────────────
# Landmark index constants
# ──────────────────────────────────────────────────────────────────────────────

# Iris centres (only available when refine_landmarks=True)
L_IRIS = 468
R_IRIS = 473

# Left eye corners
L_EYE_INNER = 133   # medial canthus
L_EYE_OUTER = 33    # lateral canthus

# Right eye corners
R_EYE_INNER = 362   # medial canthus
R_EYE_OUTER = 263   # lateral canthus

# Brow landmarks (closest brow point above each eye centre)
L_BROW = 223
R_BROW = 443

# Eye top/bottom (for eye-openness)
L_EYE_TOP = 159
L_EYE_BOT = 145
R_EYE_TOP = 386
R_EYE_BOT = 374

# Nose tip — used for face-scale normalisation and head-pose symmetry
NOSE_TIP = 1


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _lm(landmarks, idx, w, h):
    """Return landmark as (x_px, y_px) — pixel coordinates."""
    lm = landmarks[idx]
    return lm.x * w, lm.y * h


def _dist(p1, p2):
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def _clamp(val, lo=0.0, hi=100.0):
    return max(lo, min(hi, val))


# ──────────────────────────────────────────────────────────────────────────────
# Metric calculators
# ──────────────────────────────────────────────────────────────────────────────

def _eye_contact_score(lms, w, h) -> float:
    """
    Measure how centred each iris is within its eye (horizontal + vertical).
    Includes both h_offset (looking left/right) and v_offset (looking up/down).
    0 = perfect centre (100 score), 1 = at edge (0 score).
    Average the two eyes.
    """
    l_iris = _lm(lms, L_IRIS, w, h)
    r_iris = _lm(lms, R_IRIS, w, h)

    l_inner = _lm(lms, L_EYE_INNER, w, h)
    l_outer = _lm(lms, L_EYE_OUTER, w, h)
    l_top = _lm(lms, L_EYE_TOP, w, h)
    l_bot = _lm(lms, L_EYE_BOT, w, h)
    r_inner = _lm(lms, R_EYE_INNER, w, h)
    r_outer = _lm(lms, R_EYE_OUTER, w, h)
    r_top = _lm(lms, R_EYE_TOP, w, h)
    r_bot = _lm(lms, R_EYE_BOT, w, h)

    def iris_offset_2d(iris, inner, outer, top, bot):
        mid_x = (inner[0] + outer[0]) / 2
        mid_y = (top[1] + bot[1]) / 2
        half_w = _dist(inner, outer) / 2
        half_h = _dist(top, bot) / 2
        if half_w < 1e-6 or half_h < 1e-6:
            return 0.0
        h_off = abs(iris[0] - mid_x) / half_w
        v_off = abs(iris[1] - mid_y) / half_h
        return max(h_off, v_off)  # penalize any deviation (up/down or left/right)

    l_off = iris_offset_2d(l_iris, l_inner, l_outer, l_top, l_bot)
    r_off = iris_offset_2d(r_iris, r_inner, r_outer, r_top, r_bot)
    avg_off = (l_off + r_off) / 2

    # Map: 0 offset → 100, 1 offset → 0, clamp beyond
    score = (1.0 - avg_off) * 100.0
    return _clamp(score)


def _stress_score(lms, w, h) -> float:
    """
    Combine brow-to-eye distance and eye openness, normalised by face scale.

    Brow compression (furrowing) → raised stress.
    Eye squinting → also raised stress.

    face_scale = distance from nose tip (1) to the midpoint of the eyes,
    which stays relatively stable under expression changes.
    """
    nose    = _lm(lms, NOSE_TIP, w, h)
    l_top   = _lm(lms, L_EYE_TOP, w, h)
    r_top   = _lm(lms, R_EYE_TOP, w, h)
    eye_mid = ((l_top[0] + r_top[0]) / 2, (l_top[1] + r_top[1]) / 2)
    face_scale = _dist(nose, eye_mid)
    if face_scale < 1e-6:
        face_scale = 1.0

    # Brow-to-eye distances
    l_brow     = _lm(lms, L_BROW, w, h)
    r_brow     = _lm(lms, R_BROW, w, h)
    l_brow_eye = _dist(l_brow, l_top) / face_scale
    r_brow_eye = _dist(r_brow, r_top) / face_scale
    avg_brow   = (l_brow_eye + r_brow_eye) / 2

    # Eye openness
    l_bot = _lm(lms, L_EYE_BOT, w, h)
    r_bot = _lm(lms, R_EYE_BOT, w, h)
    l_open = _dist(l_top, l_bot) / face_scale
    r_open = _dist(r_top, r_bot) / face_scale
    avg_open = (l_open + r_open) / 2

    # Typical relaxed brow distance ≈ 0.25–0.40 (normalised).
    # Values below 0.20 indicate furrowing → stress.
    # Resting eye openness ≈ 0.10–0.18; squinting < 0.08 → stress.

    # Brow component: invert so low distance = high stress
    # Map [0.10, 0.35] → [100, 0]
    brow_stress = _clamp((0.35 - avg_brow) / 0.25 * 100)

    # Openness component: low = squinting = stressed
    # Map [0.05, 0.18] → [100, 0]
    open_stress = _clamp((0.18 - avg_open) / 0.13 * 100)

    # Weight: brow compression is a stronger stress signal
    stress = brow_stress * 0.6 + open_stress * 0.4
    return _clamp(stress)


def _confidence_score(lms, w, h) -> float:
    """
    Head-pose symmetry proxy: how centred is the nose tip within the face
    bounding box (horizontal axis)?  Centred → confident / facing camera.

    We use all available landmarks' x-range for the bounding box so partial
    occlusion doesn't over-penalise.
    """
    xs = [lm.x * w for lm in lms]
    face_min_x = min(xs)
    face_max_x = max(xs)
    face_width = face_max_x - face_min_x
    if face_width < 1e-6:
        return 60.0

    nose_x = _lm(lms, NOSE_TIP, w, h)[0]
    face_centre_x = (face_min_x + face_max_x) / 2
    offset = abs(nose_x - face_centre_x) / (face_width / 2)  # 0=centred, 1=edge

    # Map: 0 → 100, 1 → 0
    score = (1.0 - offset) * 100.0
    return _clamp(score)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

_NO_FACE_RESULT = {
    "face_detected": False,
    "eye_contact": 50.0,
    "stress": 30.0,
    "confidence": 60.0,
    "landmarks_count": 0,
}


def analyze_frame(image_bytes: bytes) -> dict:
    """
    Analyse a single webcam frame (JPEG or PNG bytes).

    Returns:
        {
            "eye_contact":      float,   # 0-100
            "stress":           float,   # 0-100
            "confidence":       float,   # 0-100
            "face_detected":    bool,
            "landmarks_count":  int,
        }
    """
    if not image_bytes:
        return dict(_NO_FACE_RESULT)

    # Decode image
    arr = np.frombuffer(image_bytes, np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        return dict(_NO_FACE_RESULT)

    h, w = bgr.shape[:2]
    if w < 10 or h < 10:
        return dict(_NO_FACE_RESULT)

    # BGR → RGB for MediaPipe
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    results = _face_mesh.process(rgb)

    if not results.multi_face_landmarks:
        return dict(_NO_FACE_RESULT)

    face = results.multi_face_landmarks[0]
    lms  = face.landmark
    n    = len(lms)

    if n < 478:
        # Refine landmarks weren't returned (need ≥478 for iris at 468/473)
        return dict(_NO_FACE_RESULT)

    eye_contact = _eye_contact_score(lms, w, h)
    stress      = _stress_score(lms, w, h)
    confidence  = _confidence_score(lms, w, h)

    return {
        "face_detected":   True,
        "eye_contact":     round(eye_contact, 2),
        "stress":          round(stress, 2),
        "confidence":      round(confidence, 2),
        "landmarks_count": n,
    }