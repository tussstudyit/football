CREATE DATABASE IF NOT EXISTS sannha CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sannha;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pitches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  location VARCHAR(180) NOT NULL,
  size VARCHAR(20) NOT NULL,
  price_per_hour INT UNSIGNED NOT NULL,
  features VARCHAR(255) NOT NULL DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  members_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_owner (owner_user_id),
  CONSTRAINT fk_teams_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pitch_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  team_name VARCHAR(120) NOT NULL,
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bookings_pitch FOREIGN KEY (pitch_id) REFERENCES pitches(id),
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_bookings_schedule (pitch_id, booking_date, start_time, end_time, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS friendlies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  home_team_id BIGINT UNSIGNED NOT NULL,
  away_team_id BIGINT UNSIGNED NOT NULL,
  pitch_id BIGINT UNSIGNED NULL,
  match_date DATE NOT NULL,
  match_time TIME NOT NULL,
  status ENUM('pending', 'accepted', 'declined', 'cancelled', 'reschedule_proposed', 'confirmed', 'completed') NOT NULL DEFAULT 'pending',
  created_by_team_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_friendlies_home FOREIGN KEY (home_team_id) REFERENCES teams(id),
  CONSTRAINT fk_friendlies_away FOREIGN KEY (away_team_id) REFERENCES teams(id),
  CONSTRAINT fk_friendlies_pitch FOREIGN KEY (pitch_id) REFERENCES pitches(id) ON DELETE SET NULL,
  CONSTRAINT fk_friendlies_creator_team FOREIGN KEY (created_by_team_id) REFERENCES teams(id) ON DELETE SET NULL,
  CONSTRAINT fk_friendlies_creator_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_friendlies_schedule (pitch_id, match_date, match_time, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pitches (name, location, size, price_per_hour, features)
SELECT 'Sân A1', 'Cụm sân Huy Hoàng · Bình Thạnh', 'Sân 5', 120000, 'Cỏ nhân tạo,Đèn LED,Tủ đồ'
WHERE NOT EXISTS (SELECT 1 FROM pitches WHERE name = 'Sân A1');
INSERT INTO pitches (name, location, size, price_per_hour, features)
SELECT 'Sân A2', 'Cụm sân Huy Hoàng · Bình Thạnh', 'Sân 5', 120000, 'Cỏ nhân tạo,Nước uống,Tủ đồ'
WHERE NOT EXISTS (SELECT 1 FROM pitches WHERE name = 'Sân A2');
INSERT INTO pitches (name, location, size, price_per_hour, features)
SELECT 'Sân B1', 'Sân bóng Phú Nhuận · Phú Nhuận', 'Sân 7', 180000, 'Sân 7 người,Bãi xe,Nhà vệ sinh'
WHERE NOT EXISTS (SELECT 1 FROM pitches WHERE name = 'Sân B1');
INSERT INTO pitches (name, location, size, price_per_hour, features)
SELECT 'Sân B2', 'Sân bóng Phú Nhuận · Phú Nhuận', 'Sân 7', 180000, 'Cỏ mới,Đèn LED,Tủ đồ'
WHERE NOT EXISTS (SELECT 1 FROM pitches WHERE name = 'Sân B2');
INSERT INTO pitches (name, location, size, price_per_hour, features)
SELECT 'Sân C1', 'Khu thể thao Gia Định · Gò Vấp', 'Sân 5', 100000, 'Giá tốt,Nước uống,Bãi xe'
WHERE NOT EXISTS (SELECT 1 FROM pitches WHERE name = 'Sân C1');
INSERT INTO pitches (name, location, size, price_per_hour, features)
SELECT 'Sân C2', 'Khu thể thao Gia Định · Gò Vấp', 'Sân 7', 160000, 'Sân 7 người,Đèn LED,Phòng tắm'
WHERE NOT EXISTS (SELECT 1 FROM pitches WHERE name = 'Sân C2');

