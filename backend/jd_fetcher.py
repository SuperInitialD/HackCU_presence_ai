"""
jd_fetcher.py — Job description fetcher using Playwright headless browser.

Handles JS-heavy job boards (LinkedIn, Apple, Greenhouse, Lever, Workday, etc.)
by running a real Chromium instance with stealth patches to avoid bot detection.
Falls back to a lightweight requests fetch for simple pages.
"""

import re
import asyncio
import random
from urllib.parse import urlparse

from bs4 import BeautifulSoup

# ──────────────────────────────────────────────────────────────────────────────
# User-agent pool — rotate randomly to mimic real browsers
# ──────────────────────────────────────────────────────────────────────────────

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

VIEWPORT_OPTIONS = [
    {"width": 1920, "height": 1080},
    {"width": 1440, "height": 900},
    {"width": 1366, "height": 768},
    {"width": 2560, "height": 1440},
]


def _random_ua() -> str:
    return random.choice(USER_AGENTS)


def _random_viewport() -> dict:
    return random.choice(VIEWPORT_OPTIONS)


# ──────────────────────────────────────────────────────────────────────────────
# Playwright fetch (handles JS-rendered pages)
# ──────────────────────────────────────────────────────────────────────────────

async def _fetch_with_playwright(url: str) -> str:
    """
    Launch headless Chromium, load the URL, wait for network idle,
    then return the full rendered HTML.
    """
    from playwright.async_api import async_playwright

    ua = _random_ua()
    viewport = _random_viewport()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--no-default-browser-check",
            ],
        )

        context = await browser.new_context(
            user_agent=ua,
            viewport=viewport,
            locale="en-US",
            timezone_id="America/New_York",
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
            },
        )

        # Stealth: remove webdriver property that sites use to detect bots
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
        """)

        page = await context.new_page()

        try:
            await page.goto(url, wait_until="networkidle", timeout=30_000)
        except Exception:
            # Fallback: try domcontentloaded if networkidle times out
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                await page.wait_for_timeout(3000)  # extra time for JS to render
            except Exception:
                pass

        # Extra wait for dynamic content on SPAs
        await page.wait_for_timeout(2000)

        html = await page.content()
        await browser.close()

    return html


# ──────────────────────────────────────────────────────────────────────────────
# HTML parsers per platform
# ──────────────────────────────────────────────────────────────────────────────

def _clean_text(tag) -> str:
    if tag is None:
        return ""
    text = tag.get_text(separator="\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _extract_company_from_url(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    domain = re.sub(r"^(www\.|jobs\.|careers\.|boards\.|apply\.)", "", domain)
    parts = domain.split(".")
    return parts[0].capitalize() if parts else "Unknown"


def _parse_linkedin(soup: BeautifulSoup, url: str) -> dict:
    title = ""
    company = ""
    description = ""

    # Multiple selectors LinkedIn has used over time
    for sel in ["h1.top-card-layout__title", "h1.job-title", "h1"]:
        t = soup.select_one(sel)
        if t:
            title = t.get_text(strip=True)
            break

    for sel in ["a.topcard__org-name-link", ".topcard__flavor--black-link", ".top-card-layout__card a"]:
        c = soup.select_one(sel)
        if c:
            company = c.get_text(strip=True)
            break

    for sel in [".description__text", ".show-more-less-html__markup", "#job-details", ".jobs-description"]:
        d = soup.select_one(sel)
        if d:
            description = _clean_text(d)
            break

    return {
        "title": title or "Software Engineer",
        "company": company or _extract_company_from_url(url),
        "description": description or _parse_generic(soup, url)["description"],
    }


def _parse_apple(soup: BeautifulSoup, url: str) -> dict:
    title = ""
    description = ""

    for sel in [".jdPostingTitle", "h1.hero-headline", "h1"]:
        t = soup.select_one(sel)
        if t:
            title = t.get_text(strip=True)
            break

    for sel in [".jdPostingDescription", "#jd-job-summary", ".job-description", "main"]:
        d = soup.select_one(sel)
        if d:
            description = _clean_text(d)
            if len(description) > 100:
                break

    return {
        "title": title or "Software Engineer",
        "company": "Apple",
        "description": description or _parse_generic(soup, url)["description"],
    }


def _parse_greenhouse(soup: BeautifulSoup, url: str) -> dict:
    title = soup.select_one("h1.app-title, .job-title, h1")
    company = soup.select_one(".company-name, .location")
    desc = soup.select_one("#content, .job-description, .content")

    return {
        "title": title.get_text(strip=True) if title else "Software Engineer",
        "company": company.get_text(strip=True) if company else _extract_company_from_url(url),
        "description": _clean_text(desc) if desc else _parse_generic(soup, url)["description"],
    }


def _parse_lever(soup: BeautifulSoup, url: str) -> dict:
    title = soup.select_one("h2, h1")
    company = soup.select_one(".posting-hero-company, .company-name")
    sections = soup.select(".section-wrapper, .posting-section")
    description = "\n\n".join(_clean_text(s) for s in sections) if sections else ""

    return {
        "title": title.get_text(strip=True) if title else "Software Engineer",
        "company": company.get_text(strip=True) if company else _extract_company_from_url(url),
        "description": description or _parse_generic(soup, url)["description"],
    }


def _parse_workday(soup: BeautifulSoup, url: str) -> dict:
    title = soup.select_one("[data-automation-id='jobPostingHeader'] h2, h1")
    desc = soup.select_one("[data-automation-id='jobPostingDescription'], .job-description")

    return {
        "title": title.get_text(strip=True) if title else "Software Engineer",
        "company": _extract_company_from_url(url),
        "description": _clean_text(desc) if desc else _parse_generic(soup, url)["description"],
    }


def _parse_indeed(soup: BeautifulSoup, url: str) -> dict:
    title = soup.select_one('[data-testid="jobsearch-JobInfoHeader-title"], h1.jobsearch-JobInfoHeader-title, h1')
    company = soup.select_one('[data-testid="inlineHeader-companyName"], .icl-u-lg-mr--sm')
    desc = soup.select_one('#jobDescriptionText, .jobsearch-jobDescriptionText')

    return {
        "title": title.get_text(strip=True) if title else "Software Engineer",
        "company": company.get_text(strip=True) if company else _extract_company_from_url(url),
        "description": _clean_text(desc) if desc else _parse_generic(soup, url)["description"],
    }


def _parse_generic(soup: BeautifulSoup, url: str) -> dict:
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "noscript"]):
        tag.decompose()

    title = ""
    og = soup.find("meta", property="og:title")
    if og:
        title = og.get("content", "")
    if not title:
        t = soup.find("title")
        if t:
            title = t.get_text(strip=True).split("|")[0].split("-")[0].strip()
    if not title:
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text(strip=True)

    og_site = soup.find("meta", property="og:site_name")
    company = og_site.get("content", "") if og_site else _extract_company_from_url(url)

    # Find largest text block — likely the job description
    candidates = []
    for tag in soup.find_all(["div", "article", "section", "main"]):
        text = tag.get_text(separator="\n", strip=True)
        if len(text) > 300:
            candidates.append((len(text), tag))

    candidates.sort(key=lambda x: x[0], reverse=True)
    description = ""
    if candidates:
        description = _clean_text(candidates[0][1])[:5000]

    if not description:
        body = soup.find("body")
        if body:
            description = _clean_text(body)[:4000]

    return {
        "title": title or "Software Engineer",
        "company": company or "Unknown Company",
        "description": description or "Could not extract job description.",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Router — dispatch to correct parser based on domain
# ──────────────────────────────────────────────────────────────────────────────

def _route(soup: BeautifulSoup, url: str) -> dict:
    domain = urlparse(url).netloc.lower()

    if "linkedin.com" in domain:
        return _parse_linkedin(soup, url)
    elif "apple.com" in domain:
        return _parse_apple(soup, url)
    elif "greenhouse.io" in domain or "boards.greenhouse.io" in domain:
        return _parse_greenhouse(soup, url)
    elif "lever.co" in domain or "jobs.lever.co" in domain:
        return _parse_lever(soup, url)
    elif "myworkdayjobs.com" in domain or "workday.com" in domain:
        return _parse_workday(soup, url)
    elif "indeed.com" in domain:
        return _parse_indeed(soup, url)
    else:
        return _parse_generic(soup, url)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def fetch_from_url(url: str) -> dict:
    """
    Fetch a job description from a URL.
    Uses Playwright headless browser for JS-rendered pages.
    Returns dict with title, company, description.
    """
    try:
        html = asyncio.run(_fetch_with_playwright(url))
    except Exception as e:
        return {
            "title": "Unknown Position",
            "company": _extract_company_from_url(url),
            "description": f"Failed to fetch page: {str(e)}",
        }

    soup = BeautifulSoup(html, "html.parser")

    # Check if we got a bot-detection page
    page_text = soup.get_text().lower()
    if any(kw in page_text for kw in ["please enable javascript", "enable cookies", "access denied", "captcha", "verify you are human"]):
        return {
            "title": "Access Blocked",
            "company": _extract_company_from_url(url),
            "description": "This job board blocked automated access. Please copy and paste the job description manually.",
        }

    result = _route(soup, url)

    # If description is too short, something went wrong
    if len(result.get("description", "")) < 100:
        result["description"] = "Job description could not be fully extracted. Try pasting the text directly."

    return result
