"""Shared, deliberately simple English WER scoring for the selection experiment."""

import re
import unicodedata


def words(text):
    text = unicodedata.normalize("NFKC", text).lower().replace("\u2019", "'")
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)*", text)


def score(reference, hypothesis):
    ref, hyp = words(reference), words(hypothesis)
    previous = list(range(len(hyp) + 1))
    for i, expected in enumerate(ref, 1):
        current = [i]
        for j, actual in enumerate(hyp, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (expected != actual)))
        previous = current
    return {"edits": previous[-1], "referenceWords": len(ref),
            "wer": previous[-1] / len(ref) if ref else None}
