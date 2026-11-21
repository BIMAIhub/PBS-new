import { BadgeCheck, BriefcaseBusiness, Star, Users } from 'lucide-react';
import type { LearnerCommunity, PublicFeedback } from './admissions-types';
import { dateLabel } from './ui';

export function CommunitySummary({ community }: { community?: LearnerCommunity }) {
  if (!community) return null;
  return <section className="pbs-community-summary" aria-label="PBS learner community"><div><Users size={21} /><span><strong>{community.historicalLearners + community.approvedLearners}{community.historicalLearners ? '+' : ''}</strong> learner community</span></div><div><BadgeCheck size={19} /><span><strong>{community.approvedEnrollments}</strong> approved {community.approvedEnrollments === 1 ? 'enrollment' : 'enrollments'} on this portal</span></div><p>{community.historicalLearners > 0 ? `Includes ${community.historicalLearners} historical learners reported by PBS and ${community.approvedLearners} approved ${community.approvedLearners === 1 ? 'learner' : 'learners'} on this portal. ` : ''}Live counts update after admin approval.</p></section>;
}

export function ReviewStars({ value: rating }: { value: number }) { return <span className="pbs-review-stars" aria-label={`${rating} out of 5 stars`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} size={15} fill={n <= rating ? 'currentColor' : 'none'} />)}</span>; }

export function PublicCourseReviews({ feedback = [] }: { feedback?: PublicFeedback[] }) {
  if (!feedback.length) return null;
  return <section className="pbs-public-reviews"><div className="pbs-review-section-heading"><p className="pbs-eyebrow">From completed courses</p><h2>Our learners, in their own words.</h2><p className="pbs-muted">Shared with student permission and reviewed by PBS.</p></div><div className="pbs-review-grid">{feedback.map(item => <article className="pbs-public-review" key={item.id}><div className="pbs-review-person"><img src={item.photoDataUrl} alt={item.studentName} width="56" height="56" loading="lazy" /><div><h3>{item.studentName}</h3><p>{item.qualification}</p></div><BadgeCheck size={20} /></div><ReviewStars value={item.courseRating} /><blockquote>{item.body}</blockquote><p className="pbs-review-course">{item.courseTitle}</p><div className="pbs-review-outcome"><span>Completed {dateLabel(item.completedAt)}</span>{item.placed ? <span><BriefcaseBusiness size={15} />{item.company}</span> : <span>Placement not reported</span>}</div>{item.placed && <p className="pbs-muted pbs-small">Placement reported by the learner and reviewed by PBS.</p>}{item.reply && <div className="pbs-review-reply"><strong>PBS replied</strong><p>{item.reply}</p></div>}</article>)}</div></section>;
}
