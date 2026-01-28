export interface ContentCheckResult {
  isSafe: boolean;
  issues: string[];
  suggestions: string[];
}

export const ContentModerationService = {
  /**
   * Analyze text content for compliance with ad policies and brand safety.
   * This would typically use an LLM or policy API.
   * For this implementation, we use rule-based checks for "No Hardcoded Data" compliance.
   */
  async analyzeContent(text: string): Promise<ContentCheckResult> {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Rule 1: Length check (Facebook recommends < 125 chars for primary text)
    if (text.length > 280) {
      issues.push('Content is too long for optimal engagement.');
      suggestions.push('Shorten the text to under 280 characters.');
    }

    // Rule 2: Prohibited words (Basic filter)
    const prohibitedWords = ['guarantee', 'profit', 'rich', 'cure'];
    const foundProhibited = prohibitedWords.filter(word => text.toLowerCase().includes(word));
    
    if (foundProhibited.length > 0) {
      issues.push(`Contains potential policy violation words: ${foundProhibited.join(', ')}`);
      suggestions.push('Avoid claims that might flag ad review policies.');
    }

    // Rule 3: Engagement bait check
    if (text.toLowerCase().includes('like this') || text.toLowerCase().includes('share this')) {
      issues.push('Potential engagement bait detected.');
      suggestions.push('Focus on value rather than asking for likes directly.');
    }

    return {
      isSafe: issues.length === 0,
      issues,
      suggestions
    };
  }
};
