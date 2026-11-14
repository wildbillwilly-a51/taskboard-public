import type { WikiTopic } from "@/lib/wiki-discovery-model";
export function topicPath(topic: WikiTopic, topics: WikiTopic[]): string {
  const path = [topic.title], seen = new Set([topic.id]);
  let parent = topic.parentTopicId;
  while (parent && !seen.has(parent)) { seen.add(parent); const node = topics.find(item => item.id === parent); if (!node) break; path.unshift(node.title); parent = node.parentTopicId; }
  return path.join(" / ");
}
export function topicDescendants(id: string, topics: WikiTopic[]): Set<string> {
  const result = new Set([id]);
  for (let changed = true; changed;) { changed = false; for (const topic of topics) if (topic.parentTopicId && result.has(topic.parentTopicId) && !result.has(topic.id)) { result.add(topic.id); changed = true; } }
  return result;
}
