import type { CVMetricsFrame } from '../types/interview';
import type {
  FaceLandmarkerResult,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision';

// EMA smoothing alpha — lower = smoother, higher = more responsive
const EMA_ALPHA = 0.3;

/**
 * Apply exponential moving average smoothing to a new value given
 * the previous smoothed value.
 */
export function emaSmooth(
  previous: number | undefined,
  current: number,
  alpha: number = EMA_ALPHA
): number {
  if (previous === undefined) return current;
  return alpha * current + (1 - alpha) * previous;
}

/**
 * Apply EMA smoothing to an entire CVMetricsFrame given the previous frame.
 */
export function smoothMetrics(
  previous: CVMetricsFrame | undefined,
  current: CVMetricsFrame
): CVMetricsFrame {
  if (!previous) return current;

  return {
    timestamp: current.timestamp,
    eyeContact: emaSmooth(previous.eyeContact, current.eyeContact),
    headPitch: emaSmooth(previous.headPitch, current.headPitch),
    headYaw: emaSmooth(previous.headYaw, current.headYaw),
    headRoll: emaSmooth(previous.headRoll, current.headRoll),
    smile: emaSmooth(previous.smile, current.smile),
    shoulderAlignment: emaSmooth(
      previous.shoulderAlignment,
      current.shoulderAlignment
    ),
    confidence: emaSmooth(previous.confidence, current.confidence),
  };
}

/**
 * Calculate eye contact score (0-1) from iris landmarks relative to eye corners.
 *
 * Left iris landmarks: 468-472 (468 = center)
 * Right iris landmarks: 473-477 (473 = center)
 * Left eye corners: 33 (inner), 133 (outer)
 * Right eye corners: 362 (inner), 263 (outer)
 *
 * We measure how centered the iris is horizontally within the eye opening.
 * A centered iris suggests the person is looking at the camera.
 */
function calculateEyeContact(faceLandmarks: NormalizedLandmark[]): number {
  // Check we have iris landmarks (468+ indices)
  if (faceLandmarks.length < 478) return 0;

  const leftIrisCenter = faceLandmarks[468];
  const leftInnerCorner = faceLandmarks[133];
  const leftOuterCorner = faceLandmarks[33];

  const rightIrisCenter = faceLandmarks[473];
  const rightInnerCorner = faceLandmarks[362];
  const rightOuterCorner = faceLandmarks[263];

  // Calculate horizontal deviation of iris from center of eye
  const leftEyeWidth = Math.abs(leftOuterCorner.x - leftInnerCorner.x);
  const leftEyeCenter = (leftOuterCorner.x + leftInnerCorner.x) / 2;
  const leftDeviation =
    leftEyeWidth > 0
      ? Math.abs(leftIrisCenter.x - leftEyeCenter) / (leftEyeWidth / 2)
      : 1;

  const rightEyeWidth = Math.abs(rightOuterCorner.x - rightInnerCorner.x);
  const rightEyeCenter = (rightOuterCorner.x + rightInnerCorner.x) / 2;
  const rightDeviation =
    rightEyeWidth > 0
      ? Math.abs(rightIrisCenter.x - rightEyeCenter) / (rightEyeWidth / 2)
      : 1;

  // Average deviation, then convert to a score where centered = 1.0
  const avgDeviation = (leftDeviation + rightDeviation) / 2;

  // Threshold: ~15 degrees corresponds to roughly 0.25 normalized deviation
  // Score falls off smoothly from 1.0 (centered) to 0.0 (looking away)
  const score = Math.max(0, 1 - avgDeviation * 2);

  return clamp(score, 0, 1);
}

/**
 * Extract head pose (pitch, yaw, roll) from the facial transformation matrix.
 * The matrix is a 4x4 row-major transformation matrix.
 */
function extractHeadPose(transformationMatrix: {
  rows: number;
  columns: number;
  data: number[];
}): { pitch: number; yaw: number; roll: number } {
  const m = transformationMatrix.data;

  // Extract rotation from 4x4 matrix (row-major):
  // [ m[0]  m[1]  m[2]  m[3]  ]
  // [ m[4]  m[5]  m[6]  m[7]  ]
  // [ m[8]  m[9]  m[10] m[11] ]
  // [ m[12] m[13] m[14] m[15] ]

  // Pitch (rotation around X axis) - looking up/down
  const pitch = Math.asin(-clamp(m[9], -1, 1)) * (180 / Math.PI);

  // Yaw (rotation around Y axis) - looking left/right
  const yaw = Math.atan2(m[8], m[10]) * (180 / Math.PI);

  // Roll (rotation around Z axis) - tilting head
  const roll = Math.atan2(m[1], m[5]) * (180 / Math.PI);

  return { pitch, yaw, roll };
}

/**
 * Extract smile score (0-1) from face blendshapes.
 * Uses average of mouthSmileLeft and mouthSmileRight.
 */
function calculateSmile(
  blendshapes: FaceLandmarkerResult['faceBlendshapes']
): number {
  if (!blendshapes || blendshapes.length === 0) return 0;

  const shapes = blendshapes[0].categories;
  let smileLeft = 0;
  let smileRight = 0;

  for (const shape of shapes) {
    if (shape.categoryName === 'mouthSmileLeft') {
      smileLeft = shape.score;
    } else if (shape.categoryName === 'mouthSmileRight') {
      smileRight = shape.score;
    }
  }

  return clamp((smileLeft + smileRight) / 2, 0, 1);
}

/**
 * Calculate shoulder alignment score (0-1) from pose landmarks.
 * Landmark 11 = left shoulder, Landmark 12 = right shoulder.
 * Score of 1.0 = perfectly level shoulders.
 */
function calculateShoulderAlignment(
  poseLandmarks: NormalizedLandmark[]
): number {
  if (poseLandmarks.length < 13) return 0.5; // Default if not enough landmarks

  const leftShoulder = poseLandmarks[11];
  const rightShoulder = poseLandmarks[12];

  // Check visibility - if shoulders aren't visible, return neutral score
  if (leftShoulder.visibility < 0.5 || rightShoulder.visibility < 0.5) {
    return 0.5;
  }

  // Calculate vertical difference between shoulders, normalized by horizontal distance
  const horizontalDist = Math.abs(leftShoulder.x - rightShoulder.x);
  const verticalDiff = Math.abs(leftShoulder.y - rightShoulder.y);

  if (horizontalDist < 0.01) return 0.5; // Shoulders too close / not visible

  // Ratio of vertical to horizontal offset - 0 = perfectly level
  const tiltRatio = verticalDiff / horizontalDist;

  // Convert to 0-1 score where 1 = level. A tilt ratio of 0.3+ is very uneven.
  const score = Math.max(0, 1 - tiltRatio * 3);

  return clamp(score, 0, 1);
}

/**
 * Calculate composite confidence score from individual metrics.
 * Weights: 0.3*eyeContact + 0.25*shoulderAlignment + 0.2*(head stability) + 0.15*(low pitch deviation) + 0.1*smile
 */
function calculateConfidence(
  eyeContact: number,
  shoulderAlignment: number,
  headYaw: number,
  headPitch: number,
  smile: number
): number {
  const yawScore = clamp(1 - Math.abs(headYaw) / 45, 0, 1);
  const pitchScore = clamp(1 - Math.abs(headPitch) / 30, 0, 1);

  const confidence =
    0.3 * eyeContact +
    0.25 * shoulderAlignment +
    0.2 * yawScore +
    0.15 * pitchScore +
    0.1 * smile;

  return clamp(confidence, 0, 1);
}

/**
 * Extract all CV metrics from face and pose landmarker results.
 * Returns a CVMetricsFrame with raw (unsmoothed) values.
 */
export function extractMetrics(
  faceResult: FaceLandmarkerResult | null,
  poseResult: PoseLandmarkerResult | null,
  timestamp: number
): CVMetricsFrame {
  // Defaults for when detection fails
  const defaults: CVMetricsFrame = {
    timestamp,
    eyeContact: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    smile: 0,
    shoulderAlignment: 0.5,
    confidence: 0,
  };

  if (!faceResult || faceResult.faceLandmarks.length === 0) {
    return defaults;
  }

  const faceLandmarks = faceResult.faceLandmarks[0];

  // Eye contact from iris landmarks
  const eyeContact = calculateEyeContact(faceLandmarks);

  // Head pose from transformation matrix
  let headPitch = 0;
  let headYaw = 0;
  let headRoll = 0;

  if (
    faceResult.facialTransformationMatrixes &&
    faceResult.facialTransformationMatrixes.length > 0
  ) {
    const pose = extractHeadPose(faceResult.facialTransformationMatrixes[0]);
    headPitch = pose.pitch;
    headYaw = pose.yaw;
    headRoll = pose.roll;
  }

  // Smile from blendshapes
  const smile = calculateSmile(faceResult.faceBlendshapes);

  // Shoulder alignment from pose landmarks
  let shoulderAlignment = 0.5;
  if (poseResult && poseResult.landmarks.length > 0) {
    shoulderAlignment = calculateShoulderAlignment(poseResult.landmarks[0]);
  }

  // Composite confidence score
  const confidence = calculateConfidence(
    eyeContact,
    shoulderAlignment,
    headYaw,
    headPitch,
    smile
  );

  return {
    timestamp,
    eyeContact,
    headPitch,
    headYaw,
    headRoll,
    smile,
    shoulderAlignment,
    confidence,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
