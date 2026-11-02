export const categories = ['Examinations', 'Academics', 'Admissions', 'Graduation', 'Campus news'];
export function validatePost(input) {
 const title = typeof input.title === 'string' ? input.title.trim() : '';
 const content = typeof input.content === 'string' ? input.content.trim() : '';
 const excerpt = typeof input.excerpt === 'string' ? input.excerpt.trim() : '';
 if (title.length < 5 || title.length > 180) throw Error('Title must be between 5 and 180 characters.');
 if (content.length < 20 || content.length > 50000) throw Error('Article text must be between 20 and 50,000 characters.');
 if (excerpt.length > 280) throw Error('Summary must be at most 280 characters.');
 if (!categories.includes(input.category)) throw Error('Choose a valid category.');
 if (!['draft', 'published'].includes(input.status)) throw Error('Choose draft or published.');
 return { title, content, excerpt: excerpt || content.slice(0, 280), category: input.category, status: input.status };
}
