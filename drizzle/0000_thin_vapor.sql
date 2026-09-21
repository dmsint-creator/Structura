CREATE TABLE `app_state` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `scope`)
);
--> statement-breakpoint
CREATE TABLE `stored_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` text NOT NULL,
	`created_at` text NOT NULL
);
