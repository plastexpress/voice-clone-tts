/// <reference path="../pb_data/types.d.ts" />
// =============================================================================
// pronunciation_rules — dicionário de pronúncia
//
// Regras de find/replace (texto simples ou regex) aplicadas ao texto antes de
// mandar para o motor de TTS. Ex.: trocar "GPT" por "Ji Pi Ti" para o modelo
// falar do jeito certo.
//
// Valem para toda geração (API pública e Playground) — não são por usuário.
// =============================================================================

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    const pronunciationRules = new Collection({
      type: "base",
      name: "pronunciation_rules",
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != "" && owner = @request.auth.id',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
      fields: [
        // texto (ou regex, se is_regex) a ser encontrado no texto de entrada
        { type: "text", name: "pattern", required: true, max: 500, presentable: true },
        // texto que substitui o que casou com `pattern` (pode ficar vazio)
        { type: "text", name: "replacement", required: false, max: 500 },
        // se marcado, `pattern` é tratado como regex (sintaxe do Python `re`);
        // senão, é comparado como texto literal
        { type: "bool", name: "is_regex" },
        { type: "bool", name: "case_sensitive" },
        { type: "bool", name: "enabled" },
        // ordem de aplicação quando há várias regras (menor primeiro)
        { type: "number", name: "order", onlyInt: true },
        {
          type: "relation",
          name: "owner",
          required: true,
          maxSelect: 1,
          collectionId: users.id,
          cascadeDelete: false,
        },
        { type: "autodate", name: "created", onCreate: true, onUpdate: false },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX `idx_pronunciation_rules_order` ON `pronunciation_rules` (`order`)",
        "CREATE INDEX `idx_pronunciation_rules_owner` ON `pronunciation_rules` (`owner`)",
      ],
    });
    app.save(pronunciationRules);
  },

  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("pronunciation_rules"));
    } catch (err) {
      // já removida
    }
  }
);
