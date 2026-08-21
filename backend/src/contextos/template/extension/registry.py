class ExtensionRegistry:
    def __init__(self) -> None:
        self._custom_nodes: dict[str, object] = {}
        self._routers: dict[str, object] = {}
        self._reducers: dict[str, object] = {}
        self._context_policies: dict[str, object] = {}

    def register_custom_node(self, extension_id: str, implementation: object) -> None:
        self._custom_nodes[extension_id] = implementation

    def has_custom_node(self, extension_id: str) -> bool:
        return extension_id in self._custom_nodes

    def register_router(self, extension_id: str, implementation: object) -> None:
        self._routers[extension_id] = implementation

    def has_router(self, extension_id: str) -> bool:
        return extension_id in self._routers

    def register_reducer(self, extension_id: str, implementation: object) -> None:
        self._reducers[extension_id] = implementation

    def has_reducer(self, extension_id: str) -> bool:
        return extension_id in self._reducers

    def register_context_policy(self, extension_id: str, implementation: object) -> None:
        self._context_policies[extension_id] = implementation

    def has_context_policy(self, extension_id: str) -> bool:
        return extension_id in self._context_policies

