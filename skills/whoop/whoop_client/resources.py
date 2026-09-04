"""Allowlisted WHOOP user-data resources."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ResourceSpec:
    path: str
    scope: str


RESOURCE_SPECS = {
    "cycles": ResourceSpec("/v2/cycle", "read:cycles"),
    "recovery": ResourceSpec("/v2/recovery", "read:recovery"),
    "sleep": ResourceSpec("/v2/activity/sleep", "read:sleep"),
    "workouts": ResourceSpec("/v2/activity/workout", "read:workout"),
}
