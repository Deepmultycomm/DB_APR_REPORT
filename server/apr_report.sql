-- This table stores the raw, unchanged event stream from the API.
-- It serves as a detailed log for drill-down views.
CREATE TABLE `agent_events` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `event` VARCHAR(50) NULL,
    `enabled` TINYINT(1) NULL,
    `user_id` VARCHAR(32) NULL,
    `ext` VARCHAR(50) NULL,
    `username` VARCHAR(255) NULL,
    `state` VARCHAR(255) NULL,
    `ts_epoch` INT UNSIGNED NULL,
    `start_timestamp` DATETIME NULL,
    `end_timestamps` DATETIME NULL,
    PRIMARY KEY (`id`),
    INDEX `idx_agent_events_lookup` (`ext`, `ts_epoch`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- This table stages the summarized data from the /stats API endpoint.
-- It provides call metrics and the detailed "not available" reasons.
CREATE TABLE `users_calls` (
    `ext` VARCHAR(50) NOT NULL,
    `start_timestamp` DATETIME NOT NULL,
    `name` VARCHAR(255) NULL,
    `tags` JSON NULL,
    `total_calls` INT NULL DEFAULT 0,
    `answered_calls` INT NULL DEFAULT 0,
    `talked_time` INT NULL DEFAULT 0,
    `talked_average` INT NULL DEFAULT 0,
    `duration_seconds` INT NULL DEFAULT 0,
    `max_connect_seconds` INT NULL DEFAULT 0,
    `avg_connect_seconds` INT NULL DEFAULT 0,
    `total_connect_seconds` INT NULL DEFAULT 0,
    `callee_id_number` VARCHAR(255) NULL,
    `callee_id_name` VARCHAR(255) NULL,
    `registered_time` INT NULL DEFAULT 0,
    `idle_time` INT NULL DEFAULT 0,
    `wrap_up_time` INT NULL DEFAULT 0,
    `hold_time` INT NULL DEFAULT 0,
    `on_call_time` INT NULL DEFAULT 0,
    `on_call_time_avg` INT NULL DEFAULT 0,
    `not_available_time` INT NULL DEFAULT 0,
    `not_available_detailed_report` JSON NULL,
    `end_timestamps` DATETIME NULL,
    PRIMARY KEY (`ext`, `start_timestamp`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- This is the final, aggregated table that powers the main report view.
-- It's populated by the reportDatabase.js script.
CREATE TABLE `agent_activity` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `agent_ext` VARCHAR(50) NOT NULL,
    `agent_name` VARCHAR(255) NULL,
    `report_hour` DATETIME NOT NULL,
    `start_time` DATETIME NULL,
    `end_time` DATETIME NULL,
    `available_status_secs` INT NULL DEFAULT 0,
    `login_secs` INT NULL DEFAULT 0,
    `logoff_secs` INT NULL DEFAULT 0,
    `productive_break_secs` INT NULL DEFAULT 0,
    `non_prod_break_secs` INT NULL DEFAULT 0,
    `dnd_secs` INT NULL DEFAULT 0,
    `idle_count` INT NULL DEFAULT 0,
    `notavail_count` INT NULL DEFAULT 0,
    `total_calls` INT NULL DEFAULT 0,
    `answered_calls` INT NULL DEFAULT 0,
    `failed_calls` INT NULL DEFAULT 0,
    `talk_time_secs` INT NULL DEFAULT 0,
    `idle_time_secs` INT NULL DEFAULT 0,
    `wrap_up_time_secs` INT NULL DEFAULT 0,
    `hold_time_secs` INT NULL DEFAULT 0,
    `event_details` JSON NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_agent_hourly` (`agent_ext`, `report_hour`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

ALTER TABLE agent_activity
ADD COLUMN npt_lunch_secs INT NULL DEFAULT 0,
ADD COLUMN npt_tea_break_secs INT NULL DEFAULT 0,
ADD COLUMN npt_bio_break_secs INT NULL DEFAULT 0,
ADD COLUMN npt_short_break_secs INT NULL DEFAULT 0,
ADD COLUMN npt_other_secs INT NULL DEFAULT 0;

ALTER TABLE agent_activity
ADD COLUMN pt_meeting_secs INT NULL DEFAULT 0,
ADD COLUMN pt_training_secs INT NULL DEFAULT 0,
ADD COLUMN pt_chat_secs INT NULL DEFAULT 0,
ADD COLUMN pt_tickets_secs INT NULL DEFAULT 0,
ADD COLUMN pt_outbound_secs INT NULL DEFAULT 0;