export const parsePagination = (query = {}, { page = 1, limit = 20, max = 100 } = {}) => {
  const pageNum = Math.max(1, Number(query.page) || page);
  const limitNum = Math.min(max, Math.max(1, Number(query.limit) || limit));
  return { page: pageNum, limit: limitNum, skip: (pageNum - 1) * limitNum };
};

export const paginated = ({ items, total, page, limit }) => ({
  items,
  total,
  page,
  pages: Math.ceil(total / limit) || 1,
  limit,
});

export const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
