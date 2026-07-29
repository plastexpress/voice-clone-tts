/// <reference path="../pb_data/types.d.ts" />
// =============================================================================
// Cria o primeiro usuário da INTERFACE (login por e-mail/senha na porta 8095).
// Lido de PB_INITIAL_USER_EMAIL / PB_INITIAL_USER_PASSWORD / PB_INITIAL_USER_NAME.
// Se as variáveis não estiverem definidas, a migration não faz nada.
// =============================================================================

migrate(
  (app) => {
    const email = $os.getenv("PB_INITIAL_USER_EMAIL");
    const password = $os.getenv("PB_INITIAL_USER_PASSWORD");
    const name = $os.getenv("PB_INITIAL_USER_NAME") || "Admin";

    if (!email || !password) {
      console.log("[seed] PB_INITIAL_USER_* não definido — nenhum usuário criado");
      return;
    }

    if (password.length < 8) {
      console.log("[seed] PB_INITIAL_USER_PASSWORD precisa de 8+ caracteres — pulando");
      return;
    }

    let existing = null;
    try {
      existing = app.findAuthRecordByEmail("users", email);
    } catch (err) {
      existing = null;
    }

    if (existing) {
      console.log("[seed] usuário " + email + " já existe");
      return;
    }

    const users = app.findCollectionByNameOrId("users");
    const record = new Record(users);
    record.set("email", email);
    record.set("name", name);
    record.set("role", "admin");
    record.set("verified", true);
    record.setPassword(password);
    app.save(record);

    console.log("[seed] usuário da interface criado: " + email);
  },

  (app) => {
    const email = $os.getenv("PB_INITIAL_USER_EMAIL");
    if (!email) return;
    try {
      app.delete(app.findAuthRecordByEmail("users", email));
    } catch (err) {
      // já removido
    }
  }
);
