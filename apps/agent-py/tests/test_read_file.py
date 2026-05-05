from __future__ import annotations

import os

import pytest

from ares_plugin.tools.assurance import read_file


@pytest.mark.asyncio
async def test_read_file_respects_repo_root(tmp_path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir(parents=True)
    (repo / "a.txt").write_text("hello", encoding="utf-8")
    os.environ["ASST_REPO_ROOT"] = str(repo)
    out = await read_file({"path": "a.txt"}, **{})
    assert out == "hello"
