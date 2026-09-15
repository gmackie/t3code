import * as Schema from "effect/Schema";

export const VeritasCadLink = Schema.Struct({
  projectId: Schema.NullOr(Schema.String),
  reviewId: Schema.NullOr(Schema.String),
  productionRunId: Schema.NullOr(Schema.String),
  snapshotRevision: Schema.NullOr(Schema.String),
  snapshotSha256: Schema.NullOr(Schema.String),
  pendingOperation: Schema.NullOr(Schema.Literals(["review", "production"])),
});
export type VeritasCadLink = typeof VeritasCadLink.Type;

export const VeritasCadBomLine = Schema.Struct({
  id: Schema.String,
  refdesList: Schema.Array(Schema.String),
  partNumber: Schema.NullOr(Schema.String),
  manufacturer: Schema.NullOr(Schema.String),
  value: Schema.NullOr(Schema.String),
  footprint: Schema.NullOr(Schema.String),
  lcscNumber: Schema.NullOr(Schema.String),
  unitPriceMicrousd: Schema.NullOr(Schema.Number),
  inStock: Schema.NullOr(Schema.Number),
  eol: Schema.NullOr(Schema.String),
  flags: Schema.Array(Schema.String),
});
export type VeritasCadBomLine = typeof VeritasCadBomLine.Type;

export const VeritasCadStatus = Schema.Struct({
  configured: Schema.Boolean,
  canOperate: Schema.Boolean,
  canShareSnapshot: Schema.Boolean,
  remoteError: Schema.NullOr(Schema.String),
  link: VeritasCadLink,
  review: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      signedBundleUrl: Schema.NullOr(Schema.String),
      error: Schema.NullOr(Schema.String),
    }),
  ),
  bom: Schema.Array(VeritasCadBomLine),
  production: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      state: Schema.String,
      boards: Schema.Number,
      orders: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          kind: Schema.String,
          vendor: Schema.String,
          status: Schema.String,
        }),
      ),
    }),
  ),
});
export type VeritasCadStatus = typeof VeritasCadStatus.Type;

export const VeritasCadAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("link"),
    projectId: Schema.NullOr(Schema.String),
    reviewId: Schema.NullOr(Schema.String),
    productionRunId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("review"), revision: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("production"),
    reviewId: Schema.String,
    boards: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
    route: Schema.Literals(["turnkey", "lumen-pnp", "hand"]),
    fab: Schema.Struct({
      layers: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
      widthMm: Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 2000 })),
      heightMm: Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 2000 })),
      finish: Schema.Literals(["hasl", "enig"]),
    }),
  }),
  Schema.Struct({ type: Schema.Literal("unlink") }),
]);
export type VeritasCadAction = typeof VeritasCadAction.Type;
