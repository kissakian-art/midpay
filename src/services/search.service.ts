import { SearchRepository } from "../repositories/search.repository";
import { ContentService } from "./content.service";

/**
 * SearchService — one query across creators, posts, sounds and comments. Short
 * queries (<2 chars) return empty so we don't scan on every keystroke.
 */
export class SearchService {
  constructor(private readonly search: SearchRepository, private readonly content: ContentService) {}

  async run(q: string, viewerId: string | null = null) {
    const term = (q ?? "").trim();
    if (term.length < 2) return { creators: [], posts: [], sounds: [], comments: [] };
    const like = `%${term}%`;
    const [creators, posts, sounds, comments] = await Promise.all([
      this.search.searchCreators(like, 12),
      this.search.searchPosts(like, 12),
      this.search.searchTracks(like, 12),
      this.search.searchComments(like, 15),
    ]);
    return { creators, posts: await this.content.presentItems(posts, viewerId), sounds, comments };
  }
}
