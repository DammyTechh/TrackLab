import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Field, controlClass } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { formatDate } from '@/lib/dates';
import { useNetwork } from '@/app/NetworkProvider';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_KINDS,
  openDocument,
  useAddDocument,
  useEquipmentDocuments,
  useWithdrawDocument,
  validateDocument,
  type DocumentKind,
  type EquipmentDocument,
} from './documents';

const KIND_LABEL: Record<DocumentKind, string> = { sop: 'SOP', manual: 'Manual', certificate: 'Certificate' };

const FILE_ICON = (path: string) =>
  path.endsWith('.pdf') ? 'picture_as_pdf' : path.endsWith('.docx') ? 'description' : 'image';

/**
 * Every document on a machine, for staff. Technicians and HODs in the
 * machine's lab can add and withdraw; senior leaders and staff from other
 * labs read only. Visitors never see this — they get the SOP list on the
 * passport, which is the public subset.
 */
export function EquipmentDocuments({ equipmentId, canEdit }: { equipmentId: string; canEdit: boolean }) {
  const { documents, isLoading, isError } = useEquipmentDocuments(equipmentId);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {isLoading ? <p className="m-0 text-[14px] text-ink-muted">Loading documents…</p> : null}

      {isError && documents.length === 0 ? (
        <p className="m-0 flex items-start gap-2 text-[14px] text-ink-muted">
          <Icon name="cloud_off" size={18} className="shrink-0" />
          The document list needs a connection. Anything you add now is still saved on this phone.
        </p>
      ) : null}

      {!isLoading && documents.length === 0 && !isError ? (
        <p className="m-0 text-[15px] leading-[23px] text-ink-muted">
          No documents yet.{' '}
          {canEdit ? 'Add the SOP so anyone scanning the label can read how to use this machine safely.' : ''}
        </p>
      ) : null}

      {documents.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} equipmentId={equipmentId} canEdit={canEdit} />
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        adding ? (
          <AddDocumentForm equipmentId={equipmentId} onDone={() => setAdding(false)} />
        ) : (
          <Button intent="secondary" icon="upload_file" onClick={() => setAdding(true)}>
            Add a document
          </Button>
        )
      ) : null}
    </div>
  );
}

function DocumentRow({
  doc,
  equipmentId,
  canEdit,
}: {
  doc: EquipmentDocument;
  equipmentId: string;
  canEdit: boolean;
}) {
  const withdraw = useWithdrawDocument(equipmentId);
  const { state } = useNetwork();
  const [confirming, setConfirming] = useState(false);
  const [openError, setOpenError] = useState<string>();

  async function open() {
    setOpenError(undefined);
    try {
      await openDocument(doc.file_path);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'That document could not be opened.');
    }
  }

  return (
    <li className="rounded-lg border border-line-subtle bg-surface-raised px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon name={FILE_ICON(doc.file_path)} size={28} className="shrink-0 text-ink-muted" />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] font-semibold leading-[21px] text-ink-strong">{doc.title}</p>
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] leading-[19px] text-ink-muted">
            <span className="font-semibold">{KIND_LABEL[doc.kind]}</span>
            <span aria-hidden="true">·</span>
            {doc.pending ? (
              <span className={`flex items-center gap-1 ${doc.lastError ? 'text-attention-ink' : ''}`}>
                <Icon name={doc.lastError ? 'sync_problem' : 'schedule'} size={18} />
                {doc.lastError
                  ? 'Not uploaded yet; retrying'
                  : state === 'offline'
                    ? 'Saved on this phone'
                    : 'Uploading…'}
              </span>
            ) : (
              <span className="mono">{formatDate(doc.created_at)}</span>
            )}
          </p>
        </div>
        {doc.pending ? null : (
          <Button
            intent="ghost"
            icon="open_in_new"
            onClick={() => void open()}
            aria-label={`Open ${doc.title}`}
          >
            Open
          </Button>
        )}
      </div>

      {openError ? (
        <p role="alert" className="mb-0 mt-2 flex items-start gap-2 text-[13px] text-urgent-ink">
          <Icon name="error" filled size={18} className="shrink-0" />
          {openError}
        </p>
      ) : null}

      {canEdit && !doc.pending ? (
        confirming ? (
          <div className="mt-3 rounded-md bg-surface-sunken p-3">
            <p className="m-0 text-[14px] leading-5 text-ink-strong">
              Withdraw &ldquo;{doc.title}&rdquo;?{' '}
              {doc.kind === 'sop'
                ? 'Visitors will stop seeing it on the passport.'
                : 'It will no longer be listed.'}{' '}
              The record that it was published is kept.
            </p>
            {withdraw.isError ? (
              <p role="alert" className="mb-0 mt-2 text-[13px] text-urgent-ink">
                {state === 'offline'
                  ? 'Withdrawing needs a connection. Try again on the campus network.'
                  : withdraw.error instanceof Error
                    ? withdraw.error.message
                    : 'That did not work.'}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button intent="secondary" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
              <Button
                intent="danger"
                icon="block"
                disabled={withdraw.isPending}
                onClick={() => withdraw.mutate(doc.id, { onSuccess: () => setConfirming(false) })}
              >
                {withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-2 min-h-touch text-[13px] font-semibold text-ink-muted underline-offset-2 hover:text-urgent-ink hover:underline"
          >
            Withdraw this document
          </button>
        )
      ) : null}
    </li>
  );
}

function AddDocumentForm({ equipmentId, onDone }: { equipmentId: string; onDone: () => void }) {
  const add = useAddDocument(equipmentId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>('sop');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return setError('Choose the file to attach.');
    const problem = validateDocument(file, title);
    if (problem) return setError(problem);

    setError(undefined);
    add.mutate(
      { file, title, kind },
      {
        onSuccess: onDone,
        onError: (err) => setError(err instanceof Error ? err.message : 'That document could not be saved.'),
      },
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-lg border border-line-strong bg-surface-raised p-4"
    >
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 p-0 text-[14px] font-semibold leading-[18px] text-ink-strong">Type</legend>
        <div className="grid grid-cols-3 gap-2">
          {DOCUMENT_KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              onClick={() => setKind(option.value)}
              className={[
                'min-h-touch rounded-md border px-2 text-[14px] font-semibold',
                kind === option.value
                  ? 'border-brand bg-brand text-ink-ondark'
                  : 'border-line-strong bg-surface-raised text-ink',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mb-0 mt-2 text-[13px] leading-[19px] text-ink-muted">
          {DOCUMENT_KINDS.find((k) => k.value === kind)?.hint}
        </p>
      </fieldset>

      <Field
        label="Title"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Start-up and shutdown"
      />

      <Field label="File" required help="PDF, Word, or a photo of the page. Up to 20 MB.">
        {(control) => (
          <div className="flex flex-col gap-2">
            <input
              {...control}
              ref={fileInput}
              type="file"
              accept={DOCUMENT_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(undefined);
              }}
            />
            <Button intent="secondary" icon="attach_file" onClick={() => fileInput.current?.click()}>
              {file ? 'Choose a different file' : 'Choose file'}
            </Button>
            {file ? (
              <p className={`m-0 truncate ${controlClass()} border-dashed text-[14px]`}>{file.name}</p>
            ) : null}
          </div>
        )}
      </Field>

      {error ? (
        <p role="alert" className="m-0 flex items-start gap-2 text-[14px] font-medium text-urgent-ink">
          <Icon name="error" filled size={18} className="shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button intent="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" intent="primary" icon="upload_file" block disabled={add.isPending}>
          {add.isPending ? 'Preparing…' : 'Add document'}
        </Button>
      </div>

      <p className="m-0 text-[13px] leading-[19px] text-ink-muted">
        Saves on this phone straight away and uploads when there is a connection.
      </p>
    </form>
  );
}
