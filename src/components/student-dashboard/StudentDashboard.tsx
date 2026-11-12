import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Award, BookOpen, Bot, Box, BriefcaseBusiness, CalendarDays, CircleHelp,
  ClipboardList, Clock, CreditCard, Download, FileText, IdCard,
  KeyRound, Layers, LayoutDashboard, LogOut, Settings, UploadCloud, Users, Volume2, VolumeX, X
} from 'lucide-react';
import { WorkspaceChrome, type WorkspaceAction, type WorkspaceNavGroup } from './WorkspaceChrome';
import { CourseOverviewTab } from './CourseOverviewTab';
import { LiveLearningTab } from './LiveLearningTab';
import { CapstoneProjectTab } from './CapstoneProjectTab';
import { ReportsFeedbackTab } from './ReportsFeedbackTab';
import { EnrolledCoursesTab } from './EnrolledCoursesTab';
import { FeeFinancialsTab } from './FeeFinancialsTab';
import { DownloadsVaultTab } from './DownloadsVaultTab';
import { ProfileSettingsModal } from './ProfileSettingsModal';
import { StudentIDCardModal } from './StudentIDCardModal';
import { BonafideLetterModal } from './BonafideLetterModal';
import { PayFeeModal } from './PayFeeModal';
import { ClassroomVideoModal } from './ClassroomVideoModal';
import { CohortLeaderboardModal } from './CohortLeaderboardModal';
import { CareerGoalModal } from './CareerGoalModal';
import { CodeOfConductModal } from './CodeOfConductModal';
import { CertificateGeneratorModal } from './CertificateGeneratorModal';
import { PolicyModal } from './PolicyModal';
import { LiveSessionDetailModal } from './LiveSessionDetailModal';
import { Bim3DModelViewerModal } from './Bim3DModelViewerModal';
import { BimStudyTimerModal } from './BimStudyTimerModal';
import { BimAiCopilotDrawer } from './BimAiCopilotDrawer';
import { TaskSubmissionModal } from './TaskSubmissionModal';
import { ChangePasswordModal } from './ChangePasswordModal';
import { CourseUpiEnrollModal } from './CourseUpiEnrollModal';
import { StudentPortfolioModal } from './StudentPortfolioModal';
import { CourseMcqModal } from './CourseMcqModal';
import { LiveSession, StudentProfileData, EnrolledCourseItem, FeeReceiptItem, DownloadableAsset } from './types';
import { 
  STUDENT_PROFILE_DEFAULT, 
  ENROLLED_COURSES_DATA, 
  FEE_RECEIPTS_DATA, 
  DOWNLOADABLE_ASSETS_DATA,
  LIVE_SESSIONS_DATA
} from './dashboardData';
import { studentAuthUtil } from '../../utils/studentAuth';
import { pbsAdminStore, ManagedStudent, AdminCourse } from '../../utils/pbsAdminStore';
import { soundFx } from '../../utils/soundEffects';

interface StudentDashboardProps {
  user?: any;
  onLogout?: () => void;
  onBackToHome?: () => void;
}

export type DashboardTabType = 
  | 'course_overview' 
  | 'enrolled_courses'
  | 'live_learning' 
  | 'capstone_project' 
  | 'reports_feedback'
  | 'fee_financials'
  | 'downloads_vault';

const workspaceGroups: WorkspaceNavGroup[] = [
  {
    label: 'Learning',
    pages: [
      { id: 'course_overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'enrolled_courses', label: 'My courses', icon: BookOpen },
      { id: 'live_learning', label: 'Live sessions', icon: CalendarDays },
      { id: 'capstone_project', label: 'Capstone project', icon: Layers },
    ],
  },
  {
    label: 'Resources',
    pages: [
      { id: 'downloads_vault', label: 'Downloads', icon: Download },
      { id: 'fee_financials', label: 'Fees and invoices', icon: CreditCard },
      { id: 'reports_feedback', label: 'Feedback and reviews', icon: FileText },
    ],
  },
];

const scheduledSession = LIVE_SESSIONS_DATA.find(session => !session.isCompleted);

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  user,
  onLogout,
  onBackToHome,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTabType>('course_overview');
  
  // Persistent Student Data States
  const [profileData, setProfileData] = useState<StudentProfileData>(STUDENT_PROFILE_DEFAULT);
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourseItem[]>(ENROLLED_COURSES_DATA);
  const [feeReceipts, setFeeReceipts] = useState<FeeReceiptItem[]>(() => {
    try {
      const stored = localStorage.getItem('pbs_student_receipts');
      if (stored) return JSON.parse(stored);
    } catch {}
    return FEE_RECEIPTS_DATA;
  });

  const isInitialReceiptMount = useRef(true);
  useEffect(() => {
    if (isInitialReceiptMount.current) {
      isInitialReceiptMount.current = false;
      return;
    }
    try {
      localStorage.setItem('pbs_student_receipts', JSON.stringify(feeReceipts));
    } catch {}
  }, [feeReceipts]);
  const [downloadableAssets, setDownloadableAssets] = useState<DownloadableAsset[]>(DOWNLOADABLE_ASSETS_DATA);
  const [activeCourseId, setActiveCourseId] = useState<string>('revit-mep-pro');

  // Gamification states
  const [studentXp, setStudentXp] = useState(4850);
  const streakCount = 18;
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Modals state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showStudentIDCardModal, setShowStudentIDCardModal] = useState(false);
  const [showBonafideModal, setShowBonafideModal] = useState(false);
  const [showPayFeeModal, setShowPayFeeModal] = useState(false);
  const [payFeeTarget, setPayFeeTarget] = useState<{ title: string; courseId: string; balance: number }>({
    title: 'Autodesk Revit MEP Masterclass (LOD 300 - 500)',
    courseId: 'revit-mep-pro',
    balance: 7499
  });

  // Advanced New Modals
  const [show3dModelModal, setShow3dModelModal] = useState(false);
  const [showStudyTimerModal, setShowStudyTimerModal] = useState(false);
  const [showAiCopilotDrawer, setShowAiCopilotDrawer] = useState(false);
  const [showTaskSubmissionModal, setShowTaskSubmissionModal] = useState(false);

  // Portfolio & MCQ Assessment Modals
  const [showPortfolioModal, setShowPortfolioModal] = useState(false);
  const [showCourseMcqModal, setShowCourseMcqModal] = useState(false);
  const [selectedCourseForMcq, setSelectedCourseForMcq] = useState<{ id: string; title: string }>({
    id: 'c1',
    title: 'Advanced BIM Coordination & Clash Detection with Navisworks & Revit'
  });

  const [showClassroomModal, setShowClassroomModal] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [showCareerGoalModal, setShowCareerGoalModal] = useState(false);
  const [showCodeOfConductModal, setShowCodeOfConductModal] = useState(false);
  const [showCertificateModal, setShowCertificateModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showCourseUpiEnrollModal, setShowCourseUpiEnrollModal] = useState(false);
  const [selectedCourseForUpiEnroll, setSelectedCourseForUpiEnroll] = useState<AdminCourse | null>(null);
  const [policyModalType, setPolicyModalType] = useState<'placement' | 'faq' | 'certification' | null>(null);
  const [selectedLiveSession, setSelectedLiveSession] = useState<LiveSession | null>(null);
  const [notificationAlert, setNotificationAlert] = useState<string | null>(null);

  // Session activity logger and active time tracker
  useEffect(() => {
    const sId = profileData.studentId || 'PBS-STU-2026-8492';
    // Log LMS Login Event
    pbsAdminStore.logStudentActivity(
      sId, 
      'login', 
      `Student ${profileData.fullName || 'Pravin Yadav'} logged into LMS Session.`
    );

    // Track study minutes incrementally
    const interval = setInterval(() => {
      pbsAdminStore.recordStudentActiveTime(sId, activeCourseId, 1);
    }, 60000);

    return () => clearInterval(interval);
  }, [profileData.studentId, activeCourseId]);

  // Dynamically resolve student profile from database
  useEffect(() => {
    const syncStudentData = () => {
      const studentQuery = user?.email || user?.studentId || user?.rollNumber || user?.id || studentAuthUtil.getActiveUser()?.email;
      const match = studentQuery ? pbsAdminStore.getStudentByQuery(studentQuery) : null;

      if (match) {
        setProfileData(prev => ({
          ...prev,
          studentId: match.studentId || prev.studentId,
          rollNumber: match.rollNumber || prev.rollNumber,
          fullName: match.name || prev.fullName,
          email: match.email || prev.email,
          phone: match.phone || prev.phone,
          googleEmailId: match.googleEmailId || prev.googleEmailId,
          avatarUrl: match.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(match.name)}`,
          currentCompanyRole: match.specialization || prev.currentCompanyRole,
          targetCareerRole: match.placement?.targetRole || prev.targetCareerRole,
          expectedSalary: match.placement?.expectedSalary || prev.expectedSalary,
          bio: `Enrolled BIM student in ${match.specialization || 'Revit MEP'} cohort with ${match.attendancePercent || 92}% verified attendance record.`
        }));

        if (match.growthScore) {
          setStudentXp(match.growthScore);
        }

        // Map dynamic courses
        const allCatalogCourses = pbsAdminStore.getCourses();
        const matchingCatalogCourses = allCatalogCourses.filter(c => 
          match.enrolledCourseIds?.includes(c.id) || 
          (match.specialization && c.title.toLowerCase().includes(match.specialization.toLowerCase()))
        );

        if (matchingCatalogCourses.length > 0) {
          const dynamicEnrolled: EnrolledCourseItem[] = matchingCatalogCourses.map((c, idx) => ({
            id: `enr-dyn-${idx}`,
            courseId: c.id,
            courseTitle: c.title,
            category: c.category || 'Revit',
            level: 'Cohort Core Track',
            badge: idx === 0 ? 'Primary Specialization' : 'Elective Track',
            batchMode: match.batch || 'Offline Weekend (Sat-Sun, 4 hrs/day)',
            batchSchedule: 'Saturdays & Sundays (06:00 PM - 09:30 PM IST)',
            progressPercent: 0,
            completedModules: 0,
            totalModules: c.modules?.length || 10,
            enrolledDate: 'Sept 2026',
            status: 'Active',
            instructor: c.instructor,
            totalFee: match.totalFee ?? 14999,
            paidAmount: match.paidAmount ?? 7500,
            pendingBalance: match.pendingBalance ?? 7499,
            certificateEarned: match.capstoneStatus === 'Approved & Certified',
            image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=600&q=80',
            accentColor: '#10b981'
          }));
          setEnrolledCourses(dynamicEnrolled);
          setActiveCourseId(currentId => matchingCatalogCourses.some(course => course.id === currentId)
            ? currentId
            : matchingCatalogCourses[0].id);
        } else {
          setEnrolledCourses(prev => prev.map((c, i) => i === 0 ? {
            ...c,
            courseTitle: match.specialization || c.courseTitle,
            totalFee: match.totalFee ?? c.totalFee,
            paidAmount: match.paidAmount ?? c.paidAmount,
            pendingBalance: match.pendingBalance ?? c.pendingBalance,
            progressPercent: 0,
            completedModules: 0,
            certificateEarned: false,
            status: 'Active'
          } : {
            ...c,
            progressPercent: 0,
            completedModules: 0,
            certificateEarned: false,
            status: 'Active'
          }));
        }

        // Reload receipts from storage or generate dynamic fee receipt
        try {
          const storedReceipts = localStorage.getItem('pbs_student_receipts');
          if (storedReceipts) {
            const parsedReceipts = JSON.parse(storedReceipts);
            if (Array.isArray(parsedReceipts) && parsedReceipts.length > 0) {
              setFeeReceipts(parsedReceipts);
            } else if (match.paidAmount > 0) {
              setFeeReceipts([
                {
                  receiptId: `PBS-REC-${(match.studentId || '2026').replace('PBS-STU-', '')}-01`,
                  invoiceNumber: `INV/PBS/2026-27/0${(match.rollNumber || '8492').slice(-3)}`,
                  courseId: match.enrolledCourseIds?.[0] || 'revit-mep-pro',
                  courseTitle: match.specialization || 'Autodesk Revit MEP Masterclass (LOD 300 - 500)',
                  amount: match.paidAmount || 0,
                  paymentMethod: 'Instant NetBanking / UPI Verified',
                  transactionId: `UPI/PBS/${(match.rollNumber || '8492').replace(/[^a-zA-Z0-9]/g, '')}/TXN99`,
                  date: 'Aug 2026',
                  paymentType: (match.pendingBalance ?? 0) === 0 ? 'Full Payment' : 'Installment #1',
                  status: 'Paid',
                  taxGst: Math.round((match.paidAmount || 0) * 0.18),
                  downloadUrl: '#'
                }
              ]);
            }
          }
        } catch {}
      } else if (user?.name) {
        setProfileData(prev => ({
          ...prev,
          fullName: user.name,
          email: user.email || prev.email,
          studentId: user.studentId || prev.studentId,
          rollNumber: user.rollNumber || prev.rollNumber,
          phone: user.phone || prev.phone,
          googleEmailId: user.googleEmailId || prev.googleEmailId,
          avatarUrl: user.avatar || prev.avatarUrl
        }));
      }
    };

    syncStudentData();

    window.addEventListener('pbs_store_updated', syncStudentData);
    window.addEventListener('storage', syncStudentData);
    document.addEventListener('visibilitychange', syncStudentData);

    return () => {
      window.removeEventListener('pbs_store_updated', syncStudentData);
      window.removeEventListener('storage', syncStudentData);
      document.removeEventListener('visibilitychange', syncStudentData);
    };
  }, [user]);

  const userName = profileData.fullName || user?.name || 'Student';

  const handleExportStudentJSON = () => {
    soundFx.playClick();
    const jsonStr = pbsAdminStore.exportStudentDossierJSON(profileData.studentId || profileData.email) || JSON.stringify({ student: profileData }, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PBS_Student_Academic_Dossier_${(profileData.fullName || 'Student').replace(/\s+/g, '_')}_${profileData.studentId || 'ID'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    soundFx.playSuccess();
    setNotificationAlert(`Academic Dossier (.json) downloaded for ${profileData.fullName}!`);
    setTimeout(() => setNotificationAlert(null), 5000);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundFx.enabled = next;
    if (next) soundFx.playClick();
  };

  const handleTabSwitch = (tab: DashboardTabType) => {
    soundFx.playClick();
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // Handle payment receipt & balance settlement
  const handlePaymentSuccess = (paidAmount: number, newReceipt: FeeReceiptItem) => {
    soundFx.playLevelUp();
    setFeeReceipts(prev => [newReceipt, ...prev]);

    setEnrolledCourses(prev => prev.map(course => {
      if (course.courseId === newReceipt.courseId) {
        const newPaid = course.paidAmount + paidAmount;
        const newPending = Math.max(0, course.totalFee - newPaid);
        return {
          ...course,
          paidAmount: newPaid,
          pendingBalance: newPending,
          status: newPending === 0 ? 'Active' : course.status
        };
      }
      return course;
    }));

    // Record fee payment in central admin store if this is a logged in student
    if (profileData.studentId) {
      pbsAdminStore.recordFeePayment(profileData.studentId, paidAmount);
    }

    setNotificationAlert(`Payment of ₹${paidAmount.toLocaleString('en-IN')} successfully verified! Receipt: ${newReceipt.receiptId}`);
    setTimeout(() => setNotificationAlert(null), 5000);
  };

  const handleOpenPayModal = (title: string, courseId: string, balance: number) => {
    soundFx.playClick();
    setPayFeeTarget({ title, courseId, balance });
    setShowPayFeeModal(true);
  };

  const handleDownloadAsset = (asset: DownloadableAsset) => {
    soundFx.playClick();
    const blob = new Blob([
      `PRAGMATIC BIM SOLUTION - STUDENT RESOURCE FILE\n\nTitle: ${asset.title}\nFormat: ${asset.fileFormat}\nSize: ${asset.fileSize}\nVersion: ${asset.version}\nStudent: ${profileData.fullName} (${profileData.studentId})\n\nResource Description:\n${asset.description}\n\nDownloaded from PBS Student LMS Vault.`
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${asset.title.replace(/[^a-zA-Z0-9]/g, '_')}.${asset.fileFormat}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setNotificationAlert(`Downloaded: ${asset.title}`);
    setTimeout(() => setNotificationAlert(null), 4000);
  };

  const handleDownloadSyllabus = (courseTitle: string) => {
    soundFx.playClick();
    const blob = new Blob([
      `PRAGMATIC BIM SOLUTION - COMPLETE SYLLABUS & MODULE BLUEPRINT\n\nCourse: ${courseTitle}\nAccreditation: ISO 19650 BIM Information Management\nDirector & Head Instructor: Pravin Yadav\n\nModule Breakdown:\n1. 3D Parametric Modeling (LOD 300 - 500)\n2. Navisworks Clash Detection & Coordination Matrix\n3. Dynamo Visual Scripting & Computational Automation\n4. ISO 19650 CDE & BIM Execution Plan (BEP)\n5. 4D Time Scheduling & 5D Cost Takeoffs\n\nFor queries, contact academic@pragmaticbim.com`
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${courseTitle.replace(/[^a-zA-Z0-9]/g, '_')}_Syllabus.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setNotificationAlert(`Syllabus downloaded for ${courseTitle}`);
    setTimeout(() => setNotificationAlert(null), 4000);
  };

  const coursesWithProgress = enrolledCourses.map(course => {
    const modules = pbsAdminStore.getCourseById(course.courseId)?.modules.filter(module => module.lessons.length > 0);
    if (!modules?.length || !profileData.studentId) return course;

    const progress = pbsAdminStore.getStudentCourseProgress(profileData.studentId, course.courseId);
    const completedIds = new Set(progress.completedLessonIds);
    const completedModules = modules.filter(module =>
      module.lessons.every(lesson => completedIds.has(lesson.id) || completedIds.has(lesson.title))
    ).length;
    const totalLessons = modules.reduce((sum, module) => sum + module.lessons.length, 0);
    const completedLessons = modules.reduce((sum, module) =>
      sum + module.lessons.filter(lesson => completedIds.has(lesson.id) || completedIds.has(lesson.title)).length, 0);
    return {
      ...course,
      completedModules,
      totalModules: modules.length,
      progressPercent: Math.round(100 * completedLessons / totalLessons),
    };
  });

  const activeCourse = coursesWithProgress.find(course => course.courseId === activeCourseId) ?? coursesWithProgress[0];
  const openClassroom = () => {
    if (activeCourse) setActiveCourseId(activeCourse.courseId);
    setShowClassroomModal(true);
  };
  const openExam = () => {
    setSelectedCourseForMcq({
      id: activeCourse?.courseId || 'c1',
      title: activeCourse?.courseTitle || 'BIM certification exam',
    });
    setShowCourseMcqModal(true);
  };
  const selectLiveSession = (session: LiveSession) => {
    soundFx.playClick();
    setSelectedLiveSession(session);
  };

  const studioTools: WorkspaceAction[] = [
    { label: '3D model viewer', detail: 'Inspect a coordinated BIM model', icon: Box, run: () => setShow3dModelModal(true) },
    { label: 'Study timer', detail: 'Start a focused study session', icon: Clock, run: () => setShowStudyTimerModal(true) },
    { label: 'Submit assignment', detail: 'Send your project work for review', icon: UploadCloud, run: () => setShowTaskSubmissionModal(true) },
    { label: 'BIM copilot', detail: 'Ask a question about BIM', icon: Bot, run: () => setShowAiCopilotDrawer(true) },
  ];
  const accountActions: WorkspaceAction[] = [
    { label: 'Profile and settings', icon: Settings, run: () => setShowProfileModal(true) },
    { label: 'Change password', icon: KeyRound, run: () => setShowChangePasswordModal(true) },
    { label: 'Student ID card', icon: IdCard, run: () => setShowStudentIDCardModal(true) },
    { label: 'Bonafide letter', icon: FileText, run: () => setShowBonafideModal(true) },
    { label: 'Export academic dossier', icon: Download, run: handleExportStudentJSON },
    { label: soundEnabled ? 'Mute interface sounds' : 'Enable interface sounds', icon: soundEnabled ? VolumeX : Volume2, run: toggleSound },
    ...(onBackToHome ? [{ label: 'Back to home', icon: ArrowLeft, run: onBackToHome }] : []),
    ...(onLogout ? [{ label: 'Sign out', icon: LogOut, run: onLogout }] : []),
  ];
  const searchActions: WorkspaceAction[] = [
    { label: 'Classroom', detail: 'Course videos and lessons', icon: BookOpen, run: openClassroom },
    ...studioTools,
    { label: 'BIM portfolio', icon: BriefcaseBusiness, run: () => setShowPortfolioModal(true) },
    { label: 'Course certificate', icon: Award, run: () => setShowCertificateModal(true) },
    { label: 'Certification exam', icon: ClipboardList, run: openExam },
    { label: 'Cohort leaderboard', icon: Users, run: () => setShowLeaderboardModal(true) },
    { label: 'Career goals', icon: BriefcaseBusiness, run: () => setShowCareerGoalModal(true) },
    { label: 'Help and FAQs', icon: CircleHelp, run: () => setPolicyModalType('faq') },
    ...accountActions,
  ];

  return (
    <div id="pbs-student-dashboard">
      {notificationAlert && (
        <div className="pbs-workspace-toast" role="status">
          <span>{notificationAlert}</span>
          <button type="button" className="pbs-icon-button" aria-label="Dismiss notification" onClick={() => setNotificationAlert(null)}>
            <X />
          </button>
        </div>
      )}
      <WorkspaceChrome
        groups={workspaceGroups}
        activePage={activeTab}
        onNavigate={handleTabSwitch}
        searchActions={searchActions}
        accountActions={accountActions}
        onHelp={() => setPolicyModalType('faq')}
        userName={userName}
      >
        {activeTab === 'course_overview' && (
          <CourseOverviewTab
            activeCourse={activeCourse}
            courses={coursesWithProgress}
            studentXp={studentXp}
            scheduledSession={scheduledSession}
            onSelectSession={selectLiveSession}
            tools={studioTools}
            onOpenCourses={() => handleTabSwitch('enrolled_courses')}
            onOpenCourse={(courseId) => {
              setActiveCourseId(courseId);
              handleTabSwitch('enrolled_courses');
            }}
            onOpenLiveSessions={() => handleTabSwitch('live_learning')}
            onOpenCohortLeaderboard={() => setShowLeaderboardModal(true)}
            onOpenVideoClassroom={openClassroom}
            onOpenCodeOfConduct={() => setShowCodeOfConductModal(true)}
            onOpenCertificate={() => setShowCertificateModal(true)}
            onOpenFaq={() => setPolicyModalType('faq')}
            onOpenPlacementPolicy={() => setPolicyModalType('placement')}
            onOpenCertificationPolicy={() => setPolicyModalType('certification')}
            onOpenPortfolio={() => setShowPortfolioModal(true)}
            onOpenMcqExam={openExam}
          />
        )}

        {/* TAB 2: Enrolled Courses */}
        {activeTab === 'enrolled_courses' && (
          <EnrolledCoursesTab
            enrolledCourses={coursesWithProgress}
            activeCourseId={activeCourseId}
            onSelectActiveCourse={(id) => {
              soundFx.playClick();
              setActiveCourseId(id);
              setNotificationAlert(`Switched active workspace to: ${enrolledCourses.find(c => c.courseId === id)?.courseTitle}`);
              setTimeout(() => setNotificationAlert(null), 4000);
            }}
            onOpenVideoClassroom={openClassroom}
            onOpenCertificateModal={() => setShowCertificateModal(true)}
            onOpenFeeTab={() => handleTabSwitch('fee_financials')}
            onOpenDownloadSyllabus={handleDownloadSyllabus}
            onOpenUpiEnrollModal={(course) => {
              soundFx.playClick();
              setSelectedCourseForUpiEnroll(course);
              setShowCourseUpiEnrollModal(true);
            }}
          />
        )}

        {/* TAB 3: Fees & Invoices */}
        {activeTab === 'fee_financials' && (
          <FeeFinancialsTab
            enrolledCourses={enrolledCourses}
            feeReceipts={feeReceipts}
            onOpenPayFeeModal={handleOpenPayModal}
          />
        )}

        {/* TAB 4: Downloads Vault */}
        {activeTab === 'downloads_vault' && (
          <DownloadsVaultTab
            assets={downloadableAssets}
            onDownloadAsset={handleDownloadAsset}
          />
        )}

        {/* TAB 5: Live Learning */}
        {activeTab === 'live_learning' && (
          <LiveLearningTab onSelectSession={selectLiveSession} />
        )}

        {/* TAB 6: Capstone Project */}
        {activeTab === 'capstone_project' && (
          <CapstoneProjectTab />
        )}

        {/* TAB 7: Reports & Feedback */}
        {activeTab === 'reports_feedback' && (
          <ReportsFeedbackTab />
        )}
      </WorkspaceChrome>

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        profileData={profileData}
        onSaveProfile={(updated) => {
          soundFx.playSuccess();
          setProfileData(updated);
          // Sync with student store & current user
          if (updated.studentId) {
            pbsAdminStore.updateStudent(updated.studentId, {
              name: updated.fullName,
              email: updated.email,
              phone: updated.phone,
              avatar: updated.avatarUrl,
              googleEmailId: updated.googleEmailId
            });
            studentAuthUtil.updateCurrentUser({
              name: updated.fullName,
              email: updated.email,
              phone: updated.phone,
              avatar: updated.avatarUrl,
              googleEmailId: updated.googleEmailId
            });
          }
        }}
        onOpenStudentIDCard={() => {
          setShowProfileModal(false);
          setShowStudentIDCardModal(true);
        }}
        onOpenBonafideLetter={() => {
          setShowProfileModal(false);
          setShowBonafideModal(true);
        }}
      />

      {/* Digital Student ID Card Modal */}
      <StudentIDCardModal
        isOpen={showStudentIDCardModal}
        onClose={() => setShowStudentIDCardModal(false)}
        profileData={profileData}
      />

      {/* Bonafide Certificate Modal */}
      <BonafideLetterModal
        isOpen={showBonafideModal}
        onClose={() => setShowBonafideModal(false)}
        profileData={profileData}
      />

      {/* Pay Fee Balance Modal */}
      <PayFeeModal
        isOpen={showPayFeeModal}
        onClose={() => setShowPayFeeModal(false)}
        courseTitle={payFeeTarget.title}
        courseId={payFeeTarget.courseId}
        pendingBalance={payFeeTarget.balance}
        onPaymentSuccess={handlePaymentSuccess}
      />

      {/* Interactive 3D BIM Model Inspector Modal */}
      {show3dModelModal && (
        <Bim3DModelViewerModal onClose={() => setShow3dModelModal(false)} />
      )}

      {/* Focus Study Timer & Pomodoro Modal */}
      {showStudyTimerModal && (
        <BimStudyTimerModal
          onClose={() => setShowStudyTimerModal(false)}
          streakCount={streakCount}
          onClaimDailyXp={(xp) => setStudentXp(prev => prev + xp)}
        />
      )}

      {/* AI BIM Co-Pilot Drawer */}
      <BimAiCopilotDrawer
        isOpen={showAiCopilotDrawer}
        onClose={() => setShowAiCopilotDrawer(false)}
        studentName={userName}
      />

      {/* Task Submission Modal */}
      {showTaskSubmissionModal && (
        <TaskSubmissionModal
          onClose={() => setShowTaskSubmissionModal(false)}
          onSubmitSuccess={(taskData) => {
            setStudentXp(prev => prev + 250);
            setNotificationAlert(`Task evaluated: ${taskData.taskName} (Score: ${taskData.score}/100) • +250 XP`);
            setTimeout(() => setNotificationAlert(null), 5000);
          }}
        />
      )}

      {/* Change Password Modal */}
      {showChangePasswordModal && (
        <ChangePasswordModal
          isOpen={showChangePasswordModal}
          onClose={() => setShowChangePasswordModal(false)}
          onPasswordChanged={() => {
            setNotificationAlert('Your password has been successfully updated and saved!');
            setTimeout(() => setNotificationAlert(null), 4000);
          }}
        />
      )}

      {/* Supporting Interactive Modals */}
      {showClassroomModal && (
        <ClassroomVideoModal 
          onClose={() => setShowClassroomModal(false)} 
          initialCourseId={activeCourseId}
          studentProfile={profileData}
          onOpenMcqExam={() => {
            setShowClassroomModal(false);
            setSelectedCourseForMcq({
              id: activeCourseId || 'c1',
              title: enrolledCourses.find(c => c.courseId === activeCourseId)?.courseTitle || 'Advanced BIM Coordination & Clash Detection'
            });
            setShowCourseMcqModal(true);
          }}
        />
      )}

      {showLeaderboardModal && (
        <CohortLeaderboardModal onClose={() => setShowLeaderboardModal(false)} />
      )}

      {showCareerGoalModal && (
        <CareerGoalModal onClose={() => setShowCareerGoalModal(false)} />
      )}

      {showCodeOfConductModal && (
        <CodeOfConductModal onClose={() => setShowCodeOfConductModal(false)} />
      )}

      {showCertificateModal && (
        <CertificateGeneratorModal 
          userName={userName}
          onClose={() => setShowCertificateModal(false)}
          courseId={activeCourseId || 'c1'}
          studentId={profileData.studentId}
          onOpenMcqExam={() => {
            setShowCertificateModal(false);
            setSelectedCourseForMcq({
              id: activeCourseId || 'c1',
              title: enrolledCourses.find(c => c.courseId === activeCourseId)?.courseTitle || 'Advanced BIM Coordination & Clash Detection'
            });
            setShowCourseMcqModal(true);
          }}
          onOpenTaskModal={() => {
            setShowCertificateModal(false);
            setShowTaskSubmissionModal(true);
          }}
        />
      )}

      {/* Shareable Student BIM Portfolio Modal */}
      {showPortfolioModal && (
        <StudentPortfolioModal
          studentId={profileData.studentId || 'PBS-STU-2026-8492'}
          studentName={profileData.fullName || 'Pravin Yadav'}
          initialMode="edit"
          onClose={() => setShowPortfolioModal(false)}
        />
      )}

      {/* Course MCQ Final Certification Exam Modal */}
      {showCourseMcqModal && (
        <CourseMcqModal
          courseId={selectedCourseForMcq.id}
          courseTitle={selectedCourseForMcq.title}
          studentId={profileData.studentId || 'PBS-STU-2026-8492'}
          studentName={profileData.fullName || 'Pravin Yadav'}
          onClose={() => setShowCourseMcqModal(false)}
          onOpenCertificate={() => {
            setShowCourseMcqModal(false);
            setShowCertificateModal(true);
          }}
          onOpenClassroom={() => {
            setShowCourseMcqModal(false);
            setShowClassroomModal(true);
          }}
          onExamPassed={(_score) => {
            soundFx.playSuccess();
            setNotificationAlert('Congratulations! You passed the MCQ Exam. Your official certificate is now unlocked!');
            setTimeout(() => setNotificationAlert(null), 6000);
            setShowCertificateModal(true);
          }}
        />
      )}

      {policyModalType && (
        <PolicyModal
          type={policyModalType}
          onClose={() => setPolicyModalType(null)}
        />
      )}

      {selectedLiveSession && (
        <LiveSessionDetailModal
          session={selectedLiveSession}
          onClose={() => setSelectedLiveSession(null)}
          onOpenClassroom={() => {
            setSelectedLiveSession(null);
            setShowClassroomModal(true);
          }}
        />
      )}

      {showCourseUpiEnrollModal && (
        <CourseUpiEnrollModal
          isOpen={showCourseUpiEnrollModal}
          course={selectedCourseForUpiEnroll}
          currentUser={user}
          onClose={() => {
            setShowCourseUpiEnrollModal(false);
            setSelectedCourseForUpiEnroll(null);
          }}
          onEnrollmentSuccess={(_req) => {
            soundFx.playSuccess();
            setNotificationAlert(
              `Payment UTR submitted! Your enrollment request has been sent to Admin Pravin Yadav. Once verified within 24 hours, the course will automatically appear in your LMS.`
            );
            setTimeout(() => setNotificationAlert(null), 7000);
          }}
        />
      )}
    </div>
  );
};
