import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/Layout";
import { ConfirmDialog, Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Table,
  Td,
  Th,
  Toggle,
} from "../components/ui";
import { IconPlus, IconSpellcheck, IconTrash } from "../components/icons";
import { pb, pbError } from "../lib/pb";
import type { PronunciationRule } from "../lib/types";
import { useAuth } from "../store/auth";

type FormState = {
  pattern: string;
  replacement: string;
  is_regex: boolean;
  case_sensitive: boolean;
  enabled: boolean;
  order: number;
};

const EMPTY_FORM: FormState = {
  pattern: "",
  replacement: "",
  is_regex: false,
  case_sensitive: false,
  enabled: true,
  order: 0,
};

export function Pronunciations() {
  const { user } = useAuth();
  const toast = useToast();

  const [rules, setRules] = useState<PronunciationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PronunciationRule | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<PronunciationRule | null>(null);

  const load = useCallback(async () => {
    try {
      setRules(
        await pb.collection("pronunciation_rules").getFullList<PronunciationRule>({
          sort: "order,created",
        }),
      );
    } catch (error) {
      toast.error(pbError(error, "Não consegui carregar as regras"));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, order: rules.length });
    setFormOpen(true);
  }

  function openEdit(rule: PronunciationRule) {
    setEditing(rule);
    setForm({
      pattern: rule.pattern,
      replacement: rule.replacement || "",
      is_regex: rule.is_regex,
      case_sensitive: rule.case_sensitive,
      enabled: rule.enabled,
      order: rule.order ?? 0,
    });
    setFormOpen(true);
  }

  async function save() {
    if (!user) return;
    const pattern = form.pattern.trim();
    if (!pattern) return toast.error("Informe o texto (ou regex) a ser substituído");

    if (form.is_regex) {
      try {
        new RegExp(pattern);
      } catch (error) {
        return toast.error(`Regex inválida: ${(error as Error).message}`);
      }
    }

    setSaving(true);
    try {
      const data = {
        pattern,
        replacement: form.replacement,
        is_regex: form.is_regex,
        case_sensitive: form.case_sensitive,
        enabled: form.enabled,
        order: form.order,
        owner: user.id,
      };

      if (editing) {
        await pb.collection("pronunciation_rules").update(editing.id, data);
        toast.success("Regra atualizada");
      } else {
        await pb.collection("pronunciation_rules").create(data);
        toast.success("Regra criada");
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      toast.error(pbError(error, "Não consegui salvar a regra"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(rule: PronunciationRule) {
    try {
      await pb.collection("pronunciation_rules").update(rule.id, { enabled: !rule.enabled });
      await load();
    } catch (error) {
      toast.error(pbError(error, "Não consegui atualizar a regra"));
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await pb.collection("pronunciation_rules").delete(removing.id);
      toast.success("Regra removida");
      setRemoving(null);
      await load();
    } catch (error) {
      toast.error(pbError(error, "Não consegui remover a regra"));
    }
  }

  return (
    <>
      <PageHeader
        icon="🔤"
        title="Pronúncias"
        description="Regras de find/replace (aceitam regex) aplicadas ao texto antes de gerar o áudio — úteis para corrigir siglas, nomes ou termos que o modelo lê errado."
        actions={
          <Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreate}>
            Nova regra
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-faint">Carregando…</p>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<IconSpellcheck size={26} />}
          title="Nenhuma regra cadastrada"
          description="Sem regras o texto é enviado sem alterações para o motor de TTS."
          action={
            <Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreate}>
              Criar a primeira regra
            </Button>
          }
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th className="w-12">Ordem</Th>
                <Th>Padrão</Th>
                <Th>Substituição</Th>
                <Th>Tipo</Th>
                <Th className="w-20">Ativa</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="group">
                  <Td className="text-faint">{rule.order}</Td>
                  <Td>
                    <button
                      onClick={() => openEdit(rule)}
                      className="max-w-[220px] truncate font-mono text-[12.5px] hover:underline"
                      title={rule.pattern}
                    >
                      {rule.pattern}
                    </button>
                  </Td>
                  <Td className="max-w-[220px] truncate font-mono text-[12.5px] text-muted">
                    {rule.replacement || <span className="text-faint">(vazio)</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {rule.is_regex && <Badge tone="purple">regex</Badge>}
                      {rule.case_sensitive && <Badge>case sensitive</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <button onClick={() => void toggleEnabled(rule)}>
                      <Badge tone={rule.enabled ? "success" : "neutral"}>
                        {rule.enabled ? "ativa" : "inativa"}
                      </Badge>
                    </button>
                  </Td>
                  <Td>
                    <button
                      onClick={() => setRemoving(rule)}
                      className="rounded p-1 text-faint opacity-0 transition-all hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                      title="Remover"
                    >
                      <IconTrash size={14} />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Editar regra" : "Nova regra de pronúncia"}
        description="As regras são aplicadas em ordem, no texto inteiro, antes de calcular o cache e mandar para o motor de TTS."
        footer={
          <>
            <Button onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {editing ? "Salvar" : "Criar regra"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label={form.is_regex ? "Padrão (regex)" : "Texto a procurar"}
            required
            hint={
              form.is_regex
                ? 'Sintaxe do Python "re". Pode usar grupos, ex.: (\\d+)h'
                : "Comparado como texto literal (sem interpretar caracteres especiais)."
            }
          >
            <Input
              value={form.pattern}
              onChange={(event) => setForm({ ...form, pattern: event.target.value })}
              placeholder={form.is_regex ? "\\bDr\\." : "GPT"}
              className="font-mono text-[13px]"
            />
          </Field>

          <Field
            label="Substituir por"
            hint={
              form.is_regex
                ? "Pode referenciar grupos capturados, ex.: \\1 horas."
                : "Deixe em branco para remover o trecho encontrado."
            }
          >
            <Input
              value={form.replacement}
              onChange={(event) => setForm({ ...form, replacement: event.target.value })}
              placeholder={form.is_regex ? "\\1 horas" : "Ji Pi Ti"}
              className="font-mono text-[13px]"
            />
          </Field>

          <Field label="Ordem" hint="Quando há várias regras, as de número menor são aplicadas primeiro.">
            <Input
              type="number"
              value={form.order}
              onChange={(event) => setForm({ ...form, order: Number(event.target.value) || 0 })}
            />
          </Field>

          <Toggle
            checked={form.is_regex}
            onChange={(value) => setForm({ ...form, is_regex: value })}
            label="Usar regex"
            hint="Sem isso, o padrão é comparado como texto simples."
          />

          <Toggle
            checked={form.case_sensitive}
            onChange={(value) => setForm({ ...form, case_sensitive: value })}
            label="Diferenciar maiúsculas/minúsculas"
          />

          <Toggle
            checked={form.enabled}
            onChange={(value) => setForm({ ...form, enabled: value })}
            label="Regra ativa"
            hint="Regras inativas ficam salvas mas não são aplicadas na geração."
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Remover regra"
        confirmLabel="Remover"
        message={
          <>
            O padrão <strong className="text-ink font-mono">{removing?.pattern}</strong> deixa de ser
            substituído nas próximas gerações.
          </>
        }
      />
    </>
  );
}
