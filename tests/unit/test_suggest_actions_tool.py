import pytest
from energybot.agent.tools.suggest_actions import SuggestActionsTool
from energybot.bale_adapter.actions import CATALOG_KEYS


@pytest.mark.asyncio
async def test_suggest_actions_records_valid_keys():
    tool = SuggestActionsTool()
    assert tool.name == "suggest_actions"
    # enum constrains the model to catalog keys
    assert set(tool.parameters["properties"]["actions"]["items"]["enum"]) == set(CATALOG_KEYS)
    await tool.invoke({"actions": ["query_bill", "view_profile"]})
    assert tool.selected == ["query_bill", "view_profile"]


@pytest.mark.asyncio
async def test_suggest_actions_filters_unknown_and_caps_three():
    tool = SuggestActionsTool()
    await tool.invoke({"actions": ["bogus", "query_bill", "web_login", "set_goal", "more_help"]})
    assert tool.selected == ["query_bill", "web_login", "set_goal"]
    assert "bogus" not in tool.selected


@pytest.mark.asyncio
async def test_reset_clears_selection():
    tool = SuggestActionsTool()
    await tool.invoke({"actions": ["more_help"]})
    tool.reset()
    assert tool.selected == []
