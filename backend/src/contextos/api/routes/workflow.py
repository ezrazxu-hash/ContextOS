from contextos.template.node_catalog import list_node_catalog


def get_node_catalog() -> dict[str, object]:
    return {"status": 200, "body": {"nodes": list_node_catalog()}}
