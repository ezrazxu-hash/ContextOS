import unittest


class CompiledGraphCacheTests(unittest.TestCase):
    def test_first_access_misses_and_compiles(self) -> None:
        from contextos.runtime.graph.cache import CompiledGraphCache

        calls = []
        cache = CompiledGraphCache()

        graph = cache.get_or_compile("version-1", lambda: calls.append("compiled") or "graph-1")

        self.assertEqual(graph, "graph-1")
        self.assertEqual(calls, ["compiled"])

    def test_second_access_hits_cache(self) -> None:
        from contextos.runtime.graph.cache import CompiledGraphCache

        calls = []
        cache = CompiledGraphCache()

        first = cache.get_or_compile("version-1", lambda: calls.append("compiled") or "graph-1")
        second = cache.get_or_compile("version-1", lambda: calls.append("again") or "graph-2")

        self.assertIs(first, second)
        self.assertEqual(calls, ["compiled"])

    def test_versions_are_isolated(self) -> None:
        from contextos.runtime.graph.cache import CompiledGraphCache

        cache = CompiledGraphCache()

        first = cache.get_or_compile("version-1", lambda: "graph-1")
        second = cache.get_or_compile("version-2", lambda: "graph-2")

        self.assertEqual(first, "graph-1")
        self.assertEqual(second, "graph-2")

    def test_clear_removes_cached_graphs(self) -> None:
        from contextos.runtime.graph.cache import CompiledGraphCache

        calls = []
        cache = CompiledGraphCache()
        cache.get_or_compile("version-1", lambda: calls.append("first") or "graph-1")
        cache.clear()

        graph = cache.get_or_compile("version-1", lambda: calls.append("second") or "graph-2")

        self.assertEqual(graph, "graph-2")
        self.assertEqual(calls, ["first", "second"])


if __name__ == "__main__":
    unittest.main()
