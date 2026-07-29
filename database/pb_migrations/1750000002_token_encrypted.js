/// <reference path="../pb_data/types.d.ts" />
// =============================================================================
// api_tokens: guarda o token também criptografado (reversível), além do hash.
//
// O hash continua sendo usado pra autenticar requests (não muda). O campo novo
// permite que a interface "revele" o valor original depois — só o backend, com
// a chave em TOKEN_ENCRYPTION_KEY, consegue decifrar (ver app/security.py).
// =============================================================================

migrate(
  (app) => {
    const apiTokens = app.findCollectionByNameOrId("api_tokens");

    if (!apiTokens.fields.getByName("token_encrypted")) {
      apiTokens.fields.add(
        new Field({
          type: "text",
          name: "token_encrypted",
          required: false,
          max: 500,
        })
      );
      app.save(apiTokens);
    }
  },
  (app) => {
    const apiTokens = app.findCollectionByNameOrId("api_tokens");
    const field = apiTokens.fields.getByName("token_encrypted");
    if (field) {
      apiTokens.fields.removeById(field.id);
      app.save(apiTokens);
    }
  }
);
