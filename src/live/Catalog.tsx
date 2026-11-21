import { useState } from 'react';
import { BookOpen, Search, SlidersHorizontal, Tag, Users } from 'lucide-react';
import type { Catalog, CourseSummary } from './types';
import { Button, Empty, money } from './ui';

export function CatalogBrowser({ catalog, onChoose, compact = false }: { catalog: Catalog; onChoose: (course: CourseSummary) => void; compact?: boolean }) {
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all');
  const categories = [...new Set(catalog.courses.map(course => course.category))];
  const filtered = catalog.courses.filter(course => `${course.title} ${course.description} ${course.category}`.toLowerCase().includes(search.toLowerCase()) && (category === 'all' || course.category === category));
  return <div className={`pbs-catalog-browser ${compact ? 'pbs-catalog-compact' : ''}`}>
    {catalog.offers?.[0] && <div className="pbs-offer-banner"><span className="pbs-offer-amount">{catalog.offers[0].percent}<small>% off</small></span><div><strong>{catalog.offers[0].title}</strong><p>{catalog.offers[0].description}</p></div><Tag size={23} /></div>}
    <div className="pbs-catalog-tools"><label className="pbs-live-search"><Search size={18} /><input aria-label="Search courses" type="search" placeholder="Search courses and skills" value={search} onChange={e => setSearch(e.target.value)} /></label><label className="pbs-catalog-filter"><SlidersHorizontal size={16} /><select aria-label="Course category" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All subjects</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label><span>{filtered.length} {filtered.length === 1 ? 'course' : 'courses'}</span></div>
    {!filtered.length && <Empty title={search || category !== 'all' ? 'No matching courses' : 'The course catalog is being prepared'}>{search ? 'Try another subject or skill.' : 'PBS publishes courses here when applications open. If you are an administrator, create a course and enable “Show in the enrollment catalog”.'}<a className="pbs-text-button" href="/">Open PBS workspace</a></Empty>}
    <div className="pbs-catalog-grid">{filtered.map(course => <article className="pbs-catalog-course" key={course.id}>
      <div className="pbs-catalog-cover"><img src="/bim-study-model.webp" alt="Architectural model showing structure and building services" loading="lazy" /><span>{course.category}</span></div>
      <div className="pbs-catalog-course-body"><p className="pbs-catalog-meta"><BookOpen size={15} /> {course.paused ? 'Enrollment paused' : 'PBS course'}</p><h2>{course.title}</h2><p className="pbs-catalog-summary">{course.description}</p>
        <div className="pbs-course-live-count"><Users size={16} /><span>{course.approvedEnrollments || 0} approved enrollments</span>{catalog.community?.placementAssistance && <span>Placement assistance</span>}</div><div className="pbs-catalog-price"><strong>{money(course.price?.total ?? course.fee)}</strong>{Boolean(course.price?.discount) && <><del>{money(course.fee)}</del><span>{course.price!.percent}% off</span></>}</div>
        <div className="pbs-catalog-card-footer"><Button onClick={() => onChoose(course)}>View course</Button><a className="pbs-text-button" href={`/courses/${encodeURIComponent(course.id)}`}>Course details</a></div>
      </div>
    </article>)}</div>
  </div>;
}
