from math import ceil


def benchmark_report(name: str, samples_ms: list[float], target_ms: float) -> dict[str, object]:
    sorted_samples = sorted(samples_ms)
    p50 = percentile(sorted_samples, 50)
    p95 = percentile(sorted_samples, 95)
    return {
        "name": name,
        "p50_ms": p50,
        "p95_ms": p95,
        "target_ms": target_ms,
        "status": "pass" if p95 <= target_ms else "fail",
    }


def percentile(sorted_samples: list[float], percent: int) -> float:
    if not sorted_samples:
        return 0.0
    index = max(ceil((percent / 100) * len(sorted_samples)) - 1, 0)
    return sorted_samples[index]
