# ContextOS V1 Architecture Decisions

This record captures implementation decisions for M00-T01. Later tasks may refine these decisions only when their own task scope requires it.

## ADR-001: Implementation Scope Is PRD-Led

The PRD is the source of truth when the task plan and requirements conflict. For M00-T01, no conflict was found between the PRD and the task plan: both require P0-1 through P0-9, the seven MVP scenarios, and the eight V1 success criteria to be mapped before implementation proceeds.

## ADR-002: V1 Exclusions Stay Out Of Business Implementation

P1 and explicitly excluded capabilities are not implementation tasks in V1. Examples include 多租户 SaaS, Branch Merge, Marketplace, Desktop Client, and 真正物理删除历史数据. V1 may keep narrowly scoped extension fields where the PRD requires future compatibility, but those fields must not become business features.

## ADR-003: Implementation Default Tech Stack

The task plan's 实施默认技术栈 is a default for areas where the real repository has not already chosen a stack. 真实仓库已有约定时优先沿用. For this repository state, no backend or frontend package exists yet, so M00-T01 records the default without installing dependencies or creating application scaffolding.

## ADR-004: Frontend And Backend Remain Independently Deployable

Frontend and backend work must remain physically and logically isolated. Shared behavior must not be placed in a convenience module that couples both sides. Any shared protocol model must live as an implementation-neutral contract or schema and must not import frontend or backend implementation code.
