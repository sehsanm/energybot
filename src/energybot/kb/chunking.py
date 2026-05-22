import re
import tiktoken

_ENC = tiktoken.get_encoding("cl100k_base")
_PARA = re.compile(r"\n\s*\n")
_SENT = re.compile(r"(?<=[\.\؟\!\:])\s+")


def _count(s: str) -> int:
    return len(_ENC.encode(s))


def chunk_text(text: str, *, target_tokens: int = 400, overlap_tokens: int = 60) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if _count(text) <= target_tokens:
        return [text]

    paragraphs = [p.strip() for p in _PARA.split(text) if p.strip()]
    units: list[str] = []
    for p in paragraphs:
        if _count(p) <= target_tokens:
            units.append(p)
        else:
            sents = [s.strip() for s in _SENT.split(p) if s.strip()]
            units.extend(sents or [p])

    chunks: list[str] = []
    cur: list[str] = []
    cur_tokens = 0
    for u in units:
        u_tok = _count(u)
        if cur_tokens + u_tok > target_tokens and cur:
            chunks.append(" ".join(cur))
            overlap: list[str] = []
            tally = 0
            for prev in reversed(cur):
                t = _count(prev)
                if tally + t > overlap_tokens:
                    break
                overlap.insert(0, prev)
                tally += t
            cur = overlap[:]
            cur_tokens = tally
        cur.append(u)
        cur_tokens += u_tok
    if cur:
        chunks.append(" ".join(cur))
    return chunks
