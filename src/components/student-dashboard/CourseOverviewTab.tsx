import {
  ArrowRight, ArrowUpRight, Award, BookOpen, BriefcaseBusiness, CalendarDays,
  CircleHelp, ClipboardList, FileCheck2, FileText, Layers, Play, Users
} from 'lucide-react';
import { WorkspaceActionRow, type WorkspaceAction } from './WorkspaceChrome';
import type { EnrolledCourseItem, LiveSession } from './types';

interface CourseOverviewTabProps {
  activeCourse?: EnrolledCourseItem;
  courses: EnrolledCourseItem[];
  tools: WorkspaceAction[];
  onOpenCourses: () => void;
  onOpenCourse: (courseId: string) => void;
  onOpenLiveSessions: () => void;
  onOpenCohortLeaderboard: () => void;
  onOpenVideoClassroom: () => void;
  onOpenCodeOfConduct: () => void;
  onOpenCertificate: () => void;
  onOpenFaq: () => void;
  onOpenPlacementPolicy: () => void;
  onOpenCertificationPolicy: () => void;
  onOpenPortfolio: () => void;
  onOpenMcqExam: () => void;
  onSelectSession: (session: LiveSession) => void;
  scheduledSession?: LiveSession;
  studentXp: number;
}

export function CourseOverviewTab({
  activeCourse, courses, tools, onOpenCourses, onOpenCourse, onOpenLiveSessions, onOpenCohortLeaderboard,
  onOpenVideoClassroom, onOpenCodeOfConduct, onOpenCertificate, onOpenFaq, onOpenPlacementPolicy,
  onOpenCertificationPolicy, onOpenPortfolio, onOpenMcqExam, onSelectSession, scheduledSession, studentXp
}: CourseOverviewTabProps) {
  const percent = Math.min(100, Math.max(0, activeCourse?.progressPercent ?? 0));
  const academicActions: WorkspaceAction[] = [
    { label: 'Course certificate', icon: Award, run: onOpenCertificate },
    { label: 'BIM portfolio', icon: BriefcaseBusiness, run: onOpenPortfolio },
    { label: 'Certification exam', icon: ClipboardList, run: onOpenMcqExam },
    { label: 'Cohort leaderboard', icon: Users, run: onOpenCohortLeaderboard },
  ];
  const supportActions: WorkspaceAction[] = [
    { label: 'Learner code of conduct', icon: FileText, run: onOpenCodeOfConduct },
    { label: 'Completion and certification', icon: FileCheck2, run: onOpenCertificationPolicy },
    { label: 'Placement policy', icon: BriefcaseBusiness, run: onOpenPlacementPolicy },
    { label: 'Frequently asked questions', icon: CircleHelp, run: onOpenFaq },
  ];

  return (
    <div id="course-overview-container" className="pbs-overview">
      <div className="pbs-overview-main">
        <section className="pbs-course-feature" aria-labelledby="pbs-course-feature-title">
          <div className="pbs-course-feature-content">
            <p className="pbs-section-label"><BookOpen /> {activeCourse ? 'Active course' : 'Learning'}</p>
            <h2 id="pbs-course-feature-title">{activeCourse?.courseTitle || 'Your BIM courses'}</h2>
            {activeCourse && (
              <div className="pbs-course-progress">
                <div>
                  <span>{activeCourse.completedModules} of {activeCourse.totalModules} modules</span>
                  <strong>{percent}% of lessons</strong>
                </div>
                <progress value={percent} max={100} aria-label="Active course lesson progress">{percent}%</progress>
              </div>
            )}
            <button type="button" className="pbs-button pbs-button-light" onClick={activeCourse ? onOpenVideoClassroom : onOpenCourses}>
              {activeCourse ? <><Play /> Open classroom</> : <>Browse courses <ArrowRight /></>}
            </button>
          </div>
          <div className="pbs-course-feature-image" aria-hidden="true" />
        </section>

        <section className="pbs-panel pbs-toolkit" aria-labelledby="pbs-toolkit-title">
          <div className="pbs-panel-heading"><h2 id="pbs-toolkit-title">Studio toolkit</h2></div>
          {tools.map(action => <WorkspaceActionRow key={action.label} action={action} />)}
        </section>
      </div>

      <dl className="pbs-learning-stats">
        <div><dt><BookOpen /> Enrolled courses</dt><dd>{courses.length}</dd></div>
        <div><dt><Layers /> Modules complete</dt><dd>{courses.reduce((sum, course) => sum + course.completedModules, 0)}</dd></div>
        <div><dt><Award /> Study points</dt><dd>{studentXp.toLocaleString('en-IN')}</dd></div>
      </dl>

      <div className="pbs-overview-secondary">
        <section className="pbs-panel" aria-labelledby="pbs-my-courses-title">
          <div className="pbs-panel-heading">
            <h2 id="pbs-my-courses-title">My courses</h2>
            <button type="button" className="pbs-text-button" onClick={onOpenCourses}>View courses <ArrowRight /></button>
          </div>
          {courses.length === 0 && <p className="pbs-empty">Courses appear here after enrollment.</p>}
          {courses.slice(0, 3).map(course => (
            <button type="button" key={course.id} className="pbs-action-row pbs-course-row" onClick={() => onOpenCourse(course.courseId)}>
              <span className="pbs-row-icon"><BookOpen /></span>
              <span><strong>{course.courseTitle}</strong><small>{course.category} · {course.status}</small></span>
              <span className="pbs-course-row-progress">{course.progressPercent}%</span>
              <ArrowUpRight className="pbs-row-end" />
            </button>
          ))}
        </section>

        <section className="pbs-panel pbs-session-panel" aria-labelledby="pbs-session-title">
          <div className="pbs-panel-heading"><h2 id="pbs-session-title">Live learning</h2></div>
          {scheduledSession ? (
            <button type="button" className="pbs-session-preview" onClick={() => onSelectSession(scheduledSession)}>
              <span className="pbs-session-date">
                <strong>{Number(scheduledSession.dateDay)}</strong>
                <small>{scheduledSession.dateMonth.slice(0, 1) + scheduledSession.dateMonth.slice(1).toLowerCase()}</small>
              </span>
              <span><strong>{scheduledSession.title}</strong><small>{scheduledSession.timeRange}</small></span>
              <ArrowUpRight className="pbs-row-end" />
            </button>
          ) : <p className="pbs-empty">No sessions currently scheduled.</p>}
          <button type="button" className="pbs-text-button pbs-calendar-link" onClick={onOpenLiveSessions}>
            <CalendarDays /> View schedule
          </button>
        </section>
      </div>

      <div className="pbs-overview-secondary">
        <section className="pbs-panel" aria-labelledby="pbs-credentials-title">
          <div className="pbs-panel-heading"><h2 id="pbs-credentials-title">Portfolio and credentials</h2></div>
          {academicActions.map(action => <WorkspaceActionRow key={action.label} action={action} />)}
        </section>
        <section className="pbs-panel" aria-labelledby="pbs-support-title">
          <div className="pbs-panel-heading"><h2 id="pbs-support-title">Policies and support</h2></div>
          {supportActions.map(action => <WorkspaceActionRow key={action.label} action={action} />)}
        </section>
      </div>
    </div>
  );
}
