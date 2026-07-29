import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/Layout";
import { ConfirmDialog, Modal } from "../components/Modal";
import { AudioPlayer } from "../components/AudioPlayer";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
  Toggle,
  cx,
} from "../components/ui";
import { IconMic, IconPlus, IconTrash, IconUpload, IconWave } from "../components/icons";
import { formatDate, slugify } from "../lib/format";
import { fileUrl, pb, pbError } from "../lib/pb";
import type { Voice } from "../lib/types";
import { useAuth } from "../store/auth";

const LANGUAGES = [
  "Portuguese",
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Japanese",
  "Korean",
  "Chinese",
];

type FormState = {
  name: string;
  slug: string;
  description: string;
  language: string;
  reference_text: string;
  active: boolean;
  file: File | null;
};

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  description: "",
  language: "Portuguese",
  reference_text: "",
  active: true,
  file: null,
};

export function Voices() {
  const { user } = useAuth();
  const toast = useToast();

  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Voice | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Voice | null>(null);

  const load = useCallback(async () => {
    try {
      setVoices(await pb.collection("voices").getFullList<Voice>({ sort: "name" }));
    } catch (error) {
      toast.error(pbError(error, "Não consegui carregar os clones"));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(voice: Voice) {
    setEditing(voice);
    setForm({
      name: voice.name,
      slug: voice.slug,
      description: voice.description || "",
      language: voice.language || "Portuguese",
      reference_text: voice.reference_text || "",
      active: voice.active,
      file: null,
    });
    setFormOpen(true);
  }

  async function save() {
    if (!user) return;
    const name = form.name.trim();
    const slug = (form.slug || slugify(name)).trim();

    if (!name) return toast.error("Dê um nome ao clone");
    if (slug.length < 3) return toast.error("O identificador precisa de ao menos 3 caracteres");
    if (!editing && !form.file) return toast.error("Envie um áudio de referência");

    setSaving(true);
    try {
      const data = new FormData();
      data.append("name", name);
      data.append("slug", slug);
      data.append("description", form.description.trim());
      data.append("language", form.language);
      data.append("reference_text", form.reference_text.trim());
      data.append("active", String(form.active));
      data.append("owner", user.id);
      if (form.file) data.append("reference_audio", form.file);

      if (editing) {
        await pb.collection("voices").update(editing.id, data);
        toast.success("Clone atualizado");
      } else {
        await pb.collection("voices").create(data);
        toast.success("Clone criado");
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      toast.error(pbError(error, "Não consegui salvar o clone"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await pb.collection("voices").delete(removing.id);
      toast.success("Clone removido");
      setRemoving(null);
      await load();
    } catch (error) {
      toast.error(pbError(error, "Não consegui remover o clone"));
    }
  }

  return (
    <>
      <PageHeader
        icon="🎙️"
        title="Clones de voz"
        description="Envie de 3 a 10 segundos de fala limpa. Escrever a transcrição do trecho melhora bastante a semelhança."
        actions={
          <Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreate}>
            Novo clone
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-faint">Carregando…</p>
      ) : voices.length === 0 ? (
        <EmptyState
          icon={<IconMic size={26} />}
          title="Nenhum clone cadastrado"
          description="Sem clone o modelo usa uma voz genérica. Cadastre uma referência para personalizar."
          action={
            <Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreate}>
              Criar o primeiro clone
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {voices.map((voice) => (
            <Card key={voice.id} className="group flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => openEdit(voice)} className="min-w-0 text-left">
                  <p className="flex items-center gap-2 truncate text-[14px] font-semibold text-ink hover:underline">
                    {voice.name}
                    {!voice.active && <Badge tone="warning">inativo</Badge>}
                  </p>
                  <p className="truncate font-mono text-[11px] text-faint">{voice.slug}</p>
                </button>
                <button
                  onClick={() => setRemoving(voice)}
                  className="shrink-0 rounded p-1 text-faint opacity-0 transition-all hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                  title="Remover"
                >
                  <IconTrash size={14} />
                </button>
              </div>

              {voice.description && (
                <p className="line-clamp-2 text-[13px] leading-snug text-muted">{voice.description}</p>
              )}

              {voice.reference_audio ? (
                <AudioPlayer
                  compact
                  src={fileUrl(voice, voice.reference_audio)}
                  filename={`${voice.slug}-referencia`}
                />
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-line px-2.5 py-2 text-[12px] text-faint">
                  <IconWave size={14} /> sem áudio de referência
                </div>
              )}

              <div className="flex items-center gap-2 text-[11px] text-faint">
                <Badge>{voice.language || "—"}</Badge>
                <span>criado em {formatDate(voice.created)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Editar clone" : "Novo clone de voz"}
        description="O áudio fica salvo no PocketBase e é convertido para WAV mono na primeira geração."
        footer={
          <>
            <Button onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {editing ? "Salvar" : "Criar clone"}
            </Button>
          </>
        }
      >
        <VoiceForm form={form} setForm={setForm} editing={editing} />
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Remover clone"
        confirmLabel="Remover"
        message={
          <>
            Tokens que apontam para <strong className="text-ink">{removing?.name}</strong> voltam a
            usar a voz padrão do modelo. Os áudios já gerados continuam no cache.
          </>
        }
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function VoiceForm({
  form,
  setForm,
  editing,
}: {
  form: FormState;
  setForm: (value: FormState) => void;
  editing: Voice | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function pickFile(file: File | null) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return;
    setForm({ ...form, file });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" required>
          <Input
            value={form.name}
            onChange={(event) => {
              const name = event.target.value;
              setForm({
                ...form,
                name,
                slug: form.slug && form.slug !== slugify(form.name) ? form.slug : slugify(name),
              });
            }}
            placeholder="Ex.: Maria narradora"
          />
        </Field>

        <Field label="Identificador" required hint="Usado na API quando o token permite escolher a voz.">
          <Input
            value={form.slug}
            onChange={(event) => setForm({ ...form, slug: slugify(event.target.value) })}
            placeholder="maria-narradora"
            className="font-mono text-[13px]"
          />
        </Field>
      </div>

      <Field label="Descrição">
        <Input
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          placeholder="Voz feminina, tom calmo, ritmo pausado"
        />
      </Field>

      <Field label="Áudio de referência" required={!editing} hint="WAV, MP3, M4A, FLAC ou OGG — 3 a 10 segundos, sem música ao fundo.">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pickFile(event.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          className={cx(
            "flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-line hover:bg-hover",
          )}
        >
          <IconUpload size={18} className="text-faint" />
          {form.file ? (
            <>
              <span className="text-[13px] font-medium text-ink">{form.file.name}</span>
              <span className="text-[11px] text-faint">
                {(form.file.size / 1024).toFixed(0)} KB — clique para trocar
              </span>
            </>
          ) : editing?.reference_audio ? (
            <>
              <span className="text-[13px] text-muted">
                Já existe um áudio: <span className="font-mono">{editing.reference_audio}</span>
              </span>
              <span className="text-[11px] text-faint">Clique ou arraste para substituir</span>
            </>
          ) : (
            <>
              <span className="text-[13px] text-muted">Arraste um arquivo ou clique para escolher</span>
              <span className="text-[11px] text-faint">até 25 MB</span>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.m4a,.opus"
            className="hidden"
            onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
          />
        </div>
      </Field>

      <Field
        label="Transcrição da referência"
        hint="Exatamente o que é falado no áudio. Opcional, mas melhora a clonagem."
      >
        <Textarea
          rows={2}
          value={form.reference_text}
          onChange={(event) => setForm({ ...form, reference_text: event.target.value })}
          placeholder="Bom dia, esse é um teste de gravação da minha voz."
        />
      </Field>

      <Field label="Idioma principal">
        <Select
          value={form.language}
          onChange={(event) => setForm({ ...form, language: event.target.value })}
        >
          {LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </Select>
      </Field>

      <Toggle
        checked={form.active}
        onChange={(value) => setForm({ ...form, active: value })}
        label="Clone ativo"
        hint="Clones inativos não podem ser usados pela API."
      />
    </div>
  );
}
