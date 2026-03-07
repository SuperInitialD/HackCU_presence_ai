import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

TIMEOUT = 10


def fetch_from_url(url: str) -> dict:
    """
    Fetch and parse a job description from a URL.
    Returns dict with title, company, description.
    """
    try:
        response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as e:
        return {
            "title": "Unknown Position",
            "company": _extract_company_from_url(url),
            "description": f"Failed to fetch job description: {str(e)}",
        }

    soup = BeautifulSoup(response.text, "html.parser")
    parsed_url = urlparse(url)
    domain = parsed_url.netloc.lower()

    try:
        if "linkedin.com" in domain:
            return _parse_linkedin(soup, url)
        elif "greenhouse.io" in domain or "boards.greenhouse.io" in domain:
            return _parse_greenhouse(soup, url)
        elif "lever.co" in domain or "jobs.lever.co" in domain:
            return _parse_lever(soup, url)
        elif "myworkdayjobs.com" in domain or "workday.com" in domain:
            return _parse_workday(soup, url)
        else:
            return _parse_generic(soup, url)
    except Exception:
        return _parse_generic(soup, url)


def _parse_linkedin(soup: BeautifulSoup, url: str) -> dict:
    """Parse LinkedIn job posting."""
    title = ""
    company = ""
    description = ""

    # Title
    title_tag = soup.find("h1", class_=re.compile(r"job-title|top-card.*title", re.I))
    if not title_tag:
        title_tag = soup.find("h1")
    if title_tag:
        title = title_tag.get_text(strip=True)

    # Company
    company_tag = soup.find("a", class_=re.compile(r"company|employer", re.I))
    if not company_tag:
        company_tag = soup.find(class_=re.compile(r"company-name|topcard.*company", re.I))
    if company_tag:
        company = company_tag.get_text(strip=True)

    # Description
    desc_tag = soup.find("div", class_=re.compile(r"description|job-description", re.I))
    if desc_tag:
        description = _clean_html_text(desc_tag)

    if not description:
        return _parse_generic(soup, url)

    return {
        "title": title or "Software Engineer",
        "company": company or _extract_company_from_url(url),
        "description": description,
    }


def _parse_greenhouse(soup: BeautifulSoup, url: str) -> dict:
    """Parse Greenhouse job posting."""
    title_tag = soup.find("h1", class_=re.compile(r"app-title|job-title|heading", re.I))
    if not title_tag:
        title_tag = soup.find("h1")

    company_tag = soup.find("div", class_=re.compile(r"company-name", re.I))
    if not company_tag:
        company_tag = soup.find("span", class_=re.compile(r"company", re.I))

    desc_tag = (
        soup.find("div", id="content")
        or soup.find("div", class_=re.compile(r"job-description|description", re.I))
    )

    return {
        "title": title_tag.get_text(strip=True) if title_tag else "Software Engineer",
        "company": (
            company_tag.get_text(strip=True)
            if company_tag
            else _extract_company_from_url(url)
        ),
        "description": _clean_html_text(desc_tag) if desc_tag else _parse_generic(soup, url)["description"],
    }


def _parse_lever(soup: BeautifulSoup, url: str) -> dict:
    """Parse Lever job posting."""
    title_tag = soup.find("h2") or soup.find("h1")
    company_tag = soup.find("div", class_=re.compile(r"company-name|posting-hero-company", re.I))

    desc_sections = soup.find_all("div", class_=re.compile(r"section-wrapper|posting-section", re.I))
    description = "\n\n".join(_clean_html_text(s) for s in desc_sections if s)

    if not description:
        desc_tag = soup.find("div", class_=re.compile(r"content", re.I))
        description = _clean_html_text(desc_tag) if desc_tag else ""

    return {
        "title": title_tag.get_text(strip=True) if title_tag else "Software Engineer",
        "company": (
            company_tag.get_text(strip=True)
            if company_tag
            else _extract_company_from_url(url)
        ),
        "description": description or _parse_generic(soup, url)["description"],
    }


def _parse_workday(soup: BeautifulSoup, url: str) -> dict:
    """Parse Workday job posting (limited — often JS-rendered)."""
    # Workday is heavily JS-rendered; try meta tags and visible text
    title_tag = (
        soup.find("meta", property="og:title")
        or soup.find("title")
        or soup.find("h1")
    )
    title = ""
    if title_tag:
        title = title_tag.get("content", "") or title_tag.get_text(strip=True)

    desc_tag = soup.find("meta", property="og:description")
    description = ""
    if desc_tag:
        description = desc_tag.get("content", "")

    if not description:
        # Attempt to grab body text
        body = soup.find("body")
        if body:
            description = _clean_html_text(body)[:3000]

    return {
        "title": title or "Software Engineer",
        "company": _extract_company_from_url(url),
        "description": description or "Job description not available (Workday requires JavaScript rendering).",
    }


def _parse_generic(soup: BeautifulSoup, url: str) -> dict:
    """Generic fallback parser for arbitrary job posting pages."""
    # Remove noise elements
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
        tag.decompose()

    title = ""
    # Try og:title, then <title>, then first h1
    og_title = soup.find("meta", property="og:title")
    if og_title:
        title = og_title.get("content", "")
    if not title:
        title_tag = soup.find("title")
        if title_tag:
            title = title_tag.get_text(strip=True).split("|")[0].split("-")[0].strip()
    if not title:
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text(strip=True)

    # Try og:site_name or domain for company
    og_site = soup.find("meta", property="og:site_name")
    company = og_site.get("content", "") if og_site else _extract_company_from_url(url)

    # Find the main content area — look for largest text block
    candidates = []
    for tag in soup.find_all(["div", "article", "section", "main"]):
        text = tag.get_text(separator="\n", strip=True)
        if len(text) > 200:
            candidates.append((len(text), tag))

    candidates.sort(key=lambda x: x[0], reverse=True)
    description = ""
    if candidates:
        # Take the largest block
        description = _clean_html_text(candidates[0][1])
        # Truncate to reasonable length
        description = description[:4000]

    if not description:
        body = soup.find("body")
        if body:
            description = _clean_html_text(body)[:3000]

    return {
        "title": title or "Software Engineer",
        "company": company or "Unknown Company",
        "description": description or "Could not extract job description.",
    }


def _clean_html_text(tag) -> str:
    """Extract clean text from a BeautifulSoup tag."""
    if tag is None:
        return ""
    text = tag.get_text(separator="\n", strip=True)
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Collapse spaces
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _extract_company_from_url(url: str) -> str:
    """Extract a readable company name from the URL domain."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    # Strip www. and common subdomains
    domain = re.sub(r"^(www\.|jobs\.|careers\.|boards\.)", "", domain)
    # Take the first part before the TLD
    parts = domain.split(".")
    if parts:
        name = parts[0]
        return name.capitalize()
    return "Unknown Company"
