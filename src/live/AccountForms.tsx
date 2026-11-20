import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { send } from './api';
import { useBranding } from './Branding';
import type { Account, Message, Portfolio } from './types';
import { Button, dateTimeLabel, DialogForm, Empty, Field, Input, Panel, PasswordInput, value } from './ui';

export function PasswordForm({ account, onSaved, onClose }: {
  account: Account; onSaved: (account: Account) => void; onClose: () => void;
}) {
  return <DialogForm title={account.mustChangePassword ? 'Set your password' : 'Change password'}
    detail={account.mustChangePassword ? 'Enter the temporary password from PBS and choose a new one.' : account.email}
    submit="Save password" onClose={onClose}
    onSubmit={async form => {
      const current = String(form.get('current') ?? '');
      const next = String(form.get('next') ?? '');
      if (next !== form.get('confirm')) throw new Error('The new passwords do not match.');
      const response = await send<{ account: Account }>('/auth/password', { current, next });
      onSaved(response.account);
    }}>
    <PasswordInput label={account.mustChangePassword ? 'Temporary password' : 'Current password'} name="current" autoComplete="current-password" required />
    <PasswordInput label="New password" name="next" autoComplete="new-password" minLength={12} maxLength={128} required />
    <PasswordInput label="Confirm new password" name="confirm" autoComplete="new-password" minLength={12} maxLength={128} required />
    <p className="pbs-muted">Use at least 12 characters.</p>
  </DialogForm>;
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const { brand } = useBranding();
  return <PortalDialog title={`${brand.shortName} support`} onClose={onClose}>
    <p className="pbs-muted">Contact {brand.academyName} for account access, enrollment or classroom help.</p>
    <a className="pbs-text-button" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail} <ArrowUpRight /></a>
  </PortalDialog>;
}

export function ProfileForm({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: (account: Account) => void }) {
  return <DialogForm title="Profile settings" detail={account.email} submit="Save profile" onClose={onClose}
    onSubmit={async form => {
      const result = await send<{ account: Account }>('/student/profile', { name: value(form, 'name'), phone: value(form, 'phone') }, 'PATCH');
      onSaved(result.account);
    }}>
    <Input label="Full name" name="name" defaultValue={account.name} maxLength={120} required />
    <Input label="Phone" name="phone" type="tel" defaultValue={account.phone} />
  </DialogForm>;
}

export function AdminProfileForm({ account, onClose, onSaved }: {
  account: Account; onClose: () => void; onSaved: (account: Account) => void;
}) {
  return <DialogForm title="Edit admin profile" submit="Save profile" onClose={onClose}
    onSubmit={async form => {
      const result = await send<{ account: Account }>('/admin/profile', {
        name: value(form, 'name'), email: value(form, 'email'), current: String(form.get('current') ?? ''),
      }, 'PATCH');
      onSaved(result.account);
    }}>
    <Input label="Full name" name="name" autoComplete="name" defaultValue={account.name} maxLength={120} required />
    <Input label="Sign-in email" name="email" type="email" autoComplete="username" autoCapitalize="none" defaultValue={account.email} maxLength={254} required />
    <PasswordInput label="Current password" name="current" autoComplete="current-password" required />
  </DialogForm>;
}

export function PortfolioForm({ account, portfolio, onClose, onSaved }: {
  account: Account; portfolio: Portfolio; onClose: () => void; onSaved: () => Promise<void>;
}) {
  return <DialogForm title="BIM portfolio" submit="Save portfolio" onClose={onClose}
    onSubmit={async form => {
      await send('/student/portfolio', {
        headline: value(form, 'headline'), bio: value(form, 'bio'), projectUrl: value(form, 'url'), published: form.has('published'),
        linkedin: value(form, 'linkedin'), github: value(form, 'github'), website: value(form, 'website'),
      }, 'PATCH');
      await onSaved();
    }}>
    <Input label="Headline" name="headline" defaultValue={portfolio.headline} maxLength={160} />
    <Field label="Project summary"><textarea name="bio" rows={5} maxLength={5000} defaultValue={portfolio.bio} /></Field>
    <Input label="Project link" name="url" type="url" defaultValue={portfolio.projectUrl} />
    <Input label="LinkedIn profile" name="linkedin" type="url" defaultValue={portfolio.linkedin} placeholder="https://www.linkedin.com/in/your-profile" />
    <div className="pbs-form-grid"><Input label="GitHub profile" name="github" type="url" defaultValue={portfolio.github} /><Input label="Personal website" name="website" type="url" defaultValue={portfolio.website} /></div>
    <label className="pbs-check"><input type="checkbox" name="published" defaultChecked={portfolio.published} /> Publish my portfolio link</label>
    {portfolio.published && <a className="pbs-text-button" href={`/portfolio/${encodeURIComponent(account.id)}`} target="_blank" rel="noreferrer">View public portfolio <ArrowUpRight /></a>}
  </DialogForm>;
}

export function MessagesPanel({ messages, admin, onCompose, onReply }: {
  messages: Message[]; admin?: boolean; onCompose?: () => void; onReply?: (message: Message) => void;
}) {
  return <Panel title={admin ? 'Student messages' : 'Messages with PBS'} action={onCompose && <Button onClick={onCompose}>New message</Button>}>
    {messages.length === 0 && <Empty title="No messages yet">{admin ? 'Student messages will appear here.' : 'Use a message to ask PBS for course or enrollment help.'}</Empty>}
    {messages.map(message => <article className="pbs-record-row" key={message.id}>
      <div><h3>{message.subject}</h3><p className="pbs-muted">{message.sender === 'admin' ? (admin ? `To ${message.studentName}` : 'PBS team') :
        (admin ? message.studentName : 'You')} · {dateTimeLabel(message.sentAt)}</p><p className="pbs-pre-wrap">{message.body}</p></div>
      {onReply && message.sender === 'student' && <Button quiet onClick={() => onReply(message)}>Reply</Button>}
    </article>)}
  </Panel>;
}

export function MessageForm({ student, initialSubject, onClose, onSaved }: {
  student?: { id: string; name: string }; initialSubject?: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  return <DialogForm title={student ? `Message ${student.name}` : 'Message PBS'} submit="Send message" onClose={onClose}
    onSubmit={async form => {
      await send(student ? '/admin/messages' : '/student/messages', { studentId: student?.id, subject: value(form, 'subject'), body: value(form, 'body') });
      await onSaved();
    }}>
    <Input label="Subject" name="subject" defaultValue={initialSubject} maxLength={140} required />
    <Field label="Message"><textarea name="body" rows={5} maxLength={3000} required /></Field>
  </DialogForm>;
}

export function BimAssistant({ onClose }: { onClose: () => void }) {
  const [reply, setReply] = useState('');
  return <DialogForm title="BIM assistant" submit="Ask PBS" onClose={onClose}
    onSubmit={async form => {
      const response = await send<{ reply: string }>('/ask-pbs', { question: value(form, 'question') });
      setReply(response.reply);
    }}>
    <Field label="Your BIM question"><textarea name="question" rows={3} maxLength={1500} required /></Field>
    {reply && <p className="pbs-inset pbs-pre-wrap" role="status">{reply}</p>}
  </DialogForm>;
}
