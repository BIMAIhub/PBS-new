// These helpers operate only on each test's temporary server and database.
type Client = { cookie: string };
type Request = (client: Client, endpoint: string, body?: any, method?: string, expected?: number) => Promise<any>;
export async function signInApproved(req: Request, client: Client, approval: any, password: string) {
  const temporary = approval.access?.password;
  if (!temporary) throw new Error('The test approval must issue first-time credentials.');
  await req(client, '/auth/login', { identifier: approval.enrollment.email, password: temporary, role: 'student' });
  await req(client, '/auth/password', { current: temporary, next: password });
}
export async function activateOnAnotherCourse(req: Request, admin: Client, student: Client, email: string, password: string) {
  const course = (await req(admin, '/admin/courses', { title: 'Isolated account activation course', category: 'QA', fee: 0, published: false }, 'POST', 201)).course;
  const approved = await req(admin, '/admin/students', { email, courseId: course.id, total: 0, amount: 0 }, 'POST', 201);
  await signInApproved(req, student, approved, password);
}
