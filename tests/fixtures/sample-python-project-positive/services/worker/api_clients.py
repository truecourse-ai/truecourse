"""Loop-iteration-varying type conversions.

Type conversions inside loops where the value VARIES per iteration are
not redundant casts — they're necessary conversions of dynamic data.
The runtime-cast-overhead rule should NOT flag these because there is
nothing to "pre-process before the loop": each iteration sees a
different value.

Mirrors OpenHands cases:
  enterprise/integrations/gitlab/gitlab_service.py:106 (`str(page)` — page increments per iteration)
  enterprise/integrations/github/github_view.py:445 (`str(workflow.id)` — varies per workflow)
  jira_view.py:392 (`str(e)` — exception object inside `except` body inside loop)
"""

from collections.abc import Iterable


MAX_PAGES = 10


def fetch_pages(min_access: str) -> list[str]:
    """Fetch pages, casting page counters that vary per iteration."""
    results: list[str] = []
    page = 1
    per_page = 100
    while page <= MAX_PAGES:
        # `str(page)` — page is the loop counter, varies each iteration.
        # `str(per_page)` — local variable; lowercase name not flagged.
        params_summary = "page=" + str(page) + ",size=" + str(per_page)
        results.append(params_summary)
        page += 1
    return results


def index_workflows_by_id(workflows: Iterable["WorkflowItem"]) -> dict[str, str]:
    """Member access on a loop variable — varies per iteration."""
    return {str(workflow.id): workflow.name for workflow in workflows}


def stringify_each(items: list[dict[str, int]]) -> list[str]:
    """Subscript expression — varies per iteration."""
    return [str(item["id"]) for item in items]


def compare_each(members: list[dict[str, int]], user_id: int) -> int:
    """Method call argument — varies per iteration."""
    count = 0
    for member in members:
        if str(member.get("id")) == str(user_id):
            count += 1
    return count


class WorkflowItem:
    """Workflow record."""

    def __init__(self, wid: int, name: str) -> None:
        self.id = wid
        self.name = name

    def render(self) -> str:
        """Self-using formatter."""
        return self.name + ":" + str(self.id)
