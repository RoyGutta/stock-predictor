/**
 * Every Finley topic, in matching order. Planning topics come first so that a
 * tie between a specific question ("did my spending change last month?") and a
 * general one ("spending last month") goes to the specific answer.
 */
import { CORE_TOPICS } from "./coreTopics";
import type { Topic } from "./engine";
import { PLANNING_TOPICS } from "./planningTopics";

export const ALL_TOPICS: Topic[] = [...PLANNING_TOPICS, ...CORE_TOPICS];
