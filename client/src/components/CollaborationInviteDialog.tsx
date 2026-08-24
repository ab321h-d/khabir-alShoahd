import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Clipboard, Link2, Send, ShieldCheck, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { acceptCollaborationInvite, clearInviteFromLocation, createCollaborationInvite, createCollaborationInviteUrl, inviteFromLocation, loadCollaborationContacts, removeCollaborationContact, roleLabel, type CollaborationContact, type CollaborationInvite, type CollaborationRole } from "@/lib/collaborationInvite";

type Props = {
  open: boolean;
  appRole: CollaborationRole;
  onClose: () => void;
  initialSenderName?: string;
  initialSchoolName?: string;
  onAccepted?: (invite: CollaborationInvite) => void;
  onToast?: (message: string) => void;
};

const recipientOptions: Array<{ value: CollaborationRole; label: string }> = [
  { value: "teacher", label: "معلم/ة" },
  { value: "director", label: "مدير/ة" },
];

export default function CollaborationInviteDialog({ open, appRole, onClose, initialSenderName = "", initialSchoolName = "", onAccepted, onToast }: Props) {
  const [recipientRole, setRecipientRole] = useState<CollaborationRole>(appRole === "director" ? "teacher" : "director");
  const [senderName, setSenderName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [note, setNote] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const [createdInvite, setCreatedInvite] = useState<CollaborationInvite | null>(null);
  const [incoming, setIncoming] = useState<CollaborationInvite | null>(null);
  const [mode, setMode] = useState<"create" | "receive" | "contacts">("create");
  const [pasteValue, setPasteValue] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [contacts, setContacts] = useState<CollaborationContact[]>([]);

  useEffect(() => {
    if (!open) return;
    const linkedInvite = inviteFromLocation();
    setContacts(loadCollaborationContacts());
    if (linkedInvite) { setIncoming(linkedInvite); setConfirmationCode(""); setMode("receive"); }
    else { setMode("create"); setIncoming(null); setCreatedUrl(""); setCreatedInvite(null); setConfirmationCode(""); setSenderName((value) => value || initialSenderName); setSchoolName((value) => value || initialSchoolName); }
  }, [initialSchoolName, initialSenderName, open]);

  const shareText = useMemo(() => `دعوة تعاون في تطبيق خبير الشواهد من ${roleLabel(appRole)}. افتح الرابط واختر قبول الدعوة على جهازك.`, [appRole]);
  if (!open) return null;

  const createInvite = () => {
    const invite = createCollaborationInvite({ fromRole: appRole, toRole: recipientRole, senderName, schoolName, note });
    setCreatedInvite(invite);
    setCreatedUrl(createCollaborationInviteUrl(invite));
    onToast?.("أصبحت دعوة الربط جاهزة للمشاركة");
  };

  const shareInvite = async () => {
    if (!createdUrl) return;
    try {
      if (navigator.share) await navigator.share({ title: "دعوة تعاون — خبير الشواهد", text: shareText, url: createdUrl });
      else { await navigator.clipboard.writeText(createdUrl); onToast?.("نُسخ رابط الدعوة"); }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) onToast?.("تعذرت المشاركة؛ يمكنك نسخ الرابط يدويًا");
    }
  };

  const copyInvite = async () => {
    if (!createdUrl) return;
    try { await navigator.clipboard.writeText(createdUrl); onToast?.("نُسخ رابط الدعوة"); } catch { onToast?.("تعذر النسخ في هذا المتصفح"); }
  };

  const loadPastedInvite = () => {
    try {
      const url = new URL(pasteValue.trim());
      const invite = inviteFromLocation(url.hash);
      if (!invite) return onToast?.("الرابط ليس دعوة تعاون صالحة");
      setIncoming(invite); setConfirmationCode(""); setMode("receive");
    } catch { onToast?.("الصق رابط الدعوة كاملًا"); }
  };

  const acceptInvite = () => {
    if (!incoming) return;
    const nextContacts = acceptCollaborationInvite(incoming);
    setContacts(nextContacts);
    clearInviteFromLocation();
    onAccepted?.(incoming);
    onToast?.("قُبلت الدعوة وحُفظت محليًا على هذا الجهاز");
    onClose();
  };

  const dismissInvite = () => { clearInviteFromLocation(); onClose(); };
  const openContacts = () => { setContacts(loadCollaborationContacts()); setMode("contacts"); };
  const deleteContact = (id: string) => { setContacts(removeCollaborationContact(id)); onToast?.("أزيل اتصال الفريق من هذا الجهاز"); };
  const needsConfirmation = Boolean(incoming?.verificationCode);
  const canAccept = !needsConfirmation || confirmationCode.trim().toUpperCase() === incoming?.verificationCode;

  return <div className="modal-backdrop collaboration-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="display-settings-dialog collaboration-dialog" role="dialog" aria-modal="true" aria-label="دعوات التعاون" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" type="button" onClick={dismissInvite} aria-label="إغلاق"><X size={19} /></button>
      <div className="display-settings-heading"><span><UsersRound size={23} /></span><div><p className="eyebrow">ربط مدرسي بسيط ومحفوظ محليًا</p><h3>{mode === "receive" ? "استقبال دعوة ربط" : mode === "contacts" ? "اتصالات المدرسة" : "ربط المدير والمعلمين"}</h3></div></div>
      {mode === "create" ? <>
        <p className="collaboration-lead">أنشئ رمزًا أو رابطًا وأرسله عبر واتساب أو البريد. لا تُنشأ حسابات، ولا تُرفع ملفات الشواهد أو التقييمات، ولا تحدث مزامنة تلقائية.</p>
        <div className="collaboration-role-choice" role="group" aria-label="الجهة المدعوة">{recipientOptions.map((option) => <button key={option.value} type="button" className={recipientRole === option.value ? "is-selected" : ""} onClick={() => setRecipientRole(option.value)}><UserPlus size={17} /><span>دعوة {option.label}</span></button>)}</div>
        <label className="field-card"><span>اسمك أو صفتك</span><input value={senderName} onChange={(event) => setSenderName(event.target.value.slice(0, 70))} placeholder={appRole === "director" ? "مثال: مدير/ة مدرسة الأمل" : "مثال: أ. أمل السهلي"} /></label>
        <label className="field-card"><span>اسم المدرسة (اختياري)</span><input value={schoolName} onChange={(event) => setSchoolName(event.target.value.slice(0, 90))} placeholder="مثال: مدرسة الأمل" /></label>
        <label className="field-card"><span>رسالة قصيرة (اختياري)</span><textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 160))} placeholder="يسعدنا تعاونك في تنظيم الشواهد." /></label>
        {!createdUrl ? <button className="primary-action" type="button" onClick={createInvite}><Link2 size={18} /> إنشاء دعوة ربط</button> : <div className="collaboration-ready"><span><Check size={17} /> دعوة الربط جاهزة</span><div className="collaboration-qr" aria-label="رمز QR لدعوة الربط"><QRCodeSVG value={createdUrl} size={132} level="M" includeMargin /></div><p>رمز التحقق: <strong dir="ltr">{createdInvite?.verificationCode}</strong></p><input value={createdUrl} readOnly aria-label="رابط دعوة التعاون" /><div><button type="button" onClick={() => { void copyInvite(); }}><Clipboard size={16} /> نسخ الرابط</button><button className="primary-action" type="button" onClick={() => { void shareInvite(); }}><Send size={17} /> مشاركة الدعوة</button></div></div>}
        <div className="collaboration-receive"><strong>لديك رابط أو رمز QR؟</strong><div><input value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} placeholder="الصق رابط الدعوة هنا" /><button type="button" onClick={loadPastedInvite}>فتح</button></div></div>
        <button className="collaboration-contacts-trigger" type="button" onClick={openContacts}><UsersRound size={16} /> اتصالات المدرسة على هذا الجهاز ({contacts.length})</button>
      </> : incoming ? <>
        <div className="collaboration-incoming"><span><UserPlus size={22} /></span><strong>دعوة من {incoming.senderName || roleLabel(incoming.fromRole)}</strong><small>{incoming.schoolName ? `مدرسة: ${incoming.schoolName} · ` : ""}{roleLabel(incoming.fromRole)} يدعوك لاستخدام خبير الشواهد كـ {roleLabel(incoming.toRole)}.</small>{incoming.note && <p>“{incoming.note}”</p>}</div>
        <p className="lite-mode-note">قبول الدعوة يحفظ بطاقة التواصل على جهازك فقط. لا يربط الحسابات ولا يرسل أي شواهد أو ملفات تلقائيًا.</p>
        {needsConfirmation && <label className="field-card collaboration-verification"><span><ShieldCheck size={16} /> رمز التحقق من جهاز المرسل</span><input dir="ltr" value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value.toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, "").slice(0, 6))} aria-label="رمز تحقق الدعوة" placeholder="مثال: A7K2PM" /></label>}
        <div className="collaboration-accept-actions"><button type="button" onClick={dismissInvite}>ليس الآن</button><button className="primary-action" type="button" disabled={!canAccept} onClick={acceptInvite}><Check size={18} /> قبول الربط</button></div>
      </> : <div className="collaboration-contacts"><p className="collaboration-lead">تُحفظ هذه البطاقات على هذا الجهاز فقط. حذفها لا يؤثر على جهاز الطرف الآخر.</p>{contacts.length ? <ul>{contacts.map((contact) => <li key={contact.id}><span><strong>{contact.senderName || roleLabel(contact.fromRole)}</strong><small>{contact.schoolName || roleLabel(contact.fromRole)}</small></span><button type="button" onClick={() => deleteContact(contact.id)} aria-label={`حذف اتصال ${contact.senderName || roleLabel(contact.fromRole)}`}><Trash2 size={16} /> حذف</button></li>)}</ul> : <p className="collaboration-empty">لا توجد اتصالات محفوظة بعد.</p>}<button className="collaboration-contacts-trigger" type="button" onClick={() => setMode("create")}><Link2 size={16} /> إنشاء أو فتح دعوة</button></div>}
    </section>
  </div>;
}
