"""
歌曲名模糊匹配模块
解决搜索结果和 AI 输出歌名不完全一致的问题
例如：AI 推荐"夜车"，搜索结果里可能是"夜车"或"午夜的夜车"
"""

from rapidfuzz import fuzz


def _normalize(text: str) -> str:
    """归一化文本：去除括号内容、统一全半角、去除多余空格"""
    import re
    # 去除括号内容（Live版、翻唱版等）
    text = re.sub(r"[（(][^）)]*[）)]", "", text)
    # 全角转半角
    text = text.translate(str.maketrans(
        "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ"
        "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    ))
    return text.strip()


def score_song_match(
    query_name: str,
    query_artist: str,
    candidate_name: str,
    candidate_artist: str,
) -> float:
    """
    计算单个候选歌曲与查询的匹配分数（0.0 ~ 1.0）

    歌名权重 0.65，歌手权重 0.35
    """
    qn = _normalize(query_name)
    qa = _normalize(query_artist)
    cn = _normalize(candidate_name)
    ca = _normalize(candidate_artist)

    # 歌名匹配：用 partial_ratio 处理子串情况
    name_score = max(
        fuzz.ratio(qn, cn),
        fuzz.partial_ratio(qn, cn),
        fuzz.token_sort_ratio(qn, cn),
    ) / 100.0

    # 歌手匹配：支持多歌手（"、"分隔）
    artist_scores = [
        max(fuzz.ratio(qa, a.strip()), fuzz.partial_ratio(qa, a.strip())) / 100.0
        for a in ca.split("、")
    ]
    artist_score = max(artist_scores) if artist_scores else 0.0

    return name_score * 0.65 + artist_score * 0.35


def find_best_match(
    query_name: str,
    query_artist: str,
    candidates: list[dict],
    threshold: float = 0.60,
) -> tuple[dict | None, float]:
    """
    从候选列表中找出最佳匹配

    Returns:
        (best_match, confidence)  如果 confidence < threshold 返回 (None, score)
    """
    if not candidates:
        return None, 0.0

    best: dict | None = None
    best_score = 0.0

    for song in candidates:
        score = score_song_match(
            query_name,
            query_artist,
            song.get("name", ""),
            song.get("artist", ""),
        )
        if score > best_score:
            best_score = score
            best = song

    if best_score < threshold:
        return None, best_score

    return best, best_score
