"""把本地 PDF/Markdown 提取为带页码的待审阅文本，不自动发布到知识库。"""

import argparse
import hashlib
import re
from pathlib import Path


def extract_sections(source: Path) -> list[tuple[str, str]]:
    if not source.is_file() or source.stat().st_size > 20 * 1024 * 1024:
        raise ValueError("Source must be an existing file no larger than 20 MiB.")
    if source.suffix.lower() == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(source, strict=True)
        if reader.is_encrypted or len(reader.pages) > 200:
            raise ValueError("Encrypted PDFs and PDFs over 200 pages are not supported.")
        pages = [(f"Page {number}", page.extract_text() or "") for number, page in enumerate(reader.pages, 1)]
        if any(not text.strip() for _, text in pages):
            raise ValueError("One or more pages have no extractable text. OCR or manual review is required; blank pages are not silently discarded.")
    elif source.suffix.lower() == ".md":
        pages = [("Markdown source", source.read_text(encoding="utf-8"))]
    else:
        raise ValueError("Only PDF and Markdown files are supported.")
    if not pages or not any(text.strip() for _, text in pages) or sum(len(text) for _, text in pages) > 100000:
        raise ValueError("Extracted text must contain 1–100000 characters; select a smaller document or chapter.")
    sections = []
    for page, text in pages:
        # 分段仍保留所在页；最终知识索引会给每段附上范围和安全说明。
        remaining = re.sub(r"[ \t]+", " ", text.replace("\r\n", "\n")).strip()
        number = 1
        while remaining:
            boundary = min(len(remaining), 1500)
            if boundary < len(remaining):
                split = max(remaining.rfind("\n", 0, boundary), remaining.rfind(" ", 0, boundary))
                if split > 0:
                    boundary = split
            sections.append((f"{page} · Section {number}", remaining[:boundary].strip()))
            remaining = remaining[boundary:].strip()
            number += 1
    return sections


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path, help="New Markdown draft; existing files are never overwritten.")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".md":
        parser.error("Output must be Markdown.")
    sections = extract_sections(args.source)
    digest = hashlib.sha256(args.source.read_bytes()).hexdigest()
    body = f"# Extraction draft — human review required\n\nSource SHA-256: {digest}\n\nThis extraction is not an approved manufacturer summary. Verify page text, source URL, scope and safety before publishing.\n\n"
    body += "\n\n".join(f"## {heading}\n\n{text}" for heading, text in sections) + "\n"
    with args.output.open("x", encoding="utf-8") as target:
        target.write(body)
    print(f"Extracted {len(sections)} sections. Review the draft before adding approved summaries to the knowledge manifest.")


if __name__ == "__main__":
    main()
