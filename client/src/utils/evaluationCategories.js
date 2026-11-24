export const STUDENT_RATING_SCALE = [
  { value: 1, label: 'Needs Improvement' },
  { value: 2, label: 'Fair' },
  { value: 3, label: 'Satisfactory' },
  { value: 4, label: 'Very Satisfactory' },
  { value: 5, label: 'Outstanding' },
];

export function evaluationCategories(scores, criteria) {
  const definitions = new Map(criteria.map((category) => [String(category.id), category]));
  const entries = Array.isArray(scores) ?
    scores.flatMap((entry) => entry?.category_id != null ? [[entry.category_id, entry]] : []) : Object.entries(scores || {});
  return entries.map(([id, entry]) => {
    const definition = definitions.get(String(id));
    return {
      id: definition?.id ?? id,
      name: entry?.category_name || definition?.category_name || 'Grading category',
      percentage: Number(entry?.category_percentage) || 0,
      indicators: Array.isArray(entry?.indicator_labels) ? entry.indicator_labels : definition?.indicators || [],
      ratings: Array.isArray(entry?.ratings) ? entry.ratings : Array.isArray(entry?.indicators) ? entry.indicators : [],
    };
  });
}

export function restoreEvaluationRatings(scores, criteria) {
  const saved = new Map(evaluationCategories(scores, criteria).map((entry) => [String(entry.id), entry]));
  return Object.fromEntries(criteria.map((category) => {
    const entry = saved.get(String(category.id));
    const ratings = category.indicators.map((indicator, index) => {
      if (!entry) return '';
      const savedIndex = entry.indicators[index] === indicator ? index : entry.indicators.indexOf(indicator);
      return entry.ratings[savedIndex] ?? '';
    });
    return [category.id, ratings];
  }));
}
