CREATE TABLE "daily_scores" (
	"date" text NOT NULL,
	"account_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"outcome" text NOT NULL,
	"turns" integer NOT NULL,
	"orders" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_scores_date_account_id_pk" PRIMARY KEY("date","account_id")
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"account_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"season" integer NOT NULL,
	"rating" double precision NOT NULL,
	"deviation" double precision NOT NULL,
	"volatility" double precision NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_account_id_mode_season_pk" PRIMARY KEY("account_id","mode","season")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "ranked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "season" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "rules" jsonb;--> statement-breakpoint
ALTER TABLE "daily_scores" ADD CONSTRAINT "daily_scores_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_scores_rank" ON "daily_scores" USING btree ("date","score");--> statement-breakpoint
CREATE INDEX "ratings_board" ON "ratings" USING btree ("mode","season","rating");