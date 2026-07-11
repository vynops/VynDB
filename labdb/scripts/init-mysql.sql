-- ============================================================
-- VynDB Lab — MySQL 8.0 Schema + Seed Data
-- ============================================================

USE labdb;

-- ── Tables ──────────────────────────────────────────────────

CREATE TABLE users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  name       VARCHAR(255) NOT NULL,
  plan       VARCHAR(50)  DEFAULT 'free',
  country    VARCHAR(2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_plan (plan),
  INDEX idx_country (country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE products (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  category   VARCHAR(100),
  price      DECIMAL(10,2),
  stock      INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE orders (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,            -- no FK index intentionally
  status     VARCHAR(50) DEFAULT 'pending',
  total      DECIMAL(12,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  shipped_at DATETIME,
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,            -- no FK index intentionally
  product_id INT NOT NULL,
  quantity   INT NOT NULL,
  unit_price DECIMAL(10,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sessions (
  id         VARCHAR(64) PRIMARY KEY,
  user_id    INT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ip         VARCHAR(45),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Stored procedure to bulk-insert seed data ────────────────

DELIMITER $$
CREATE PROCEDURE seed_data()
BEGIN
  DECLARE i INT DEFAULT 1;

  -- Users: 5,000 rows
  WHILE i <= 5000 DO
    INSERT IGNORE INTO users (email, name, plan, country)
    VALUES (
      CONCAT('user', i, '@labdb.dev'),
      CONCAT('User ', i),
      ELT(FLOOR(RAND()*3)+1, 'free','pro','enterprise'),
      ELT(FLOOR(RAND()*5)+1, 'US','GB','DE','FR','IN')
    );
    SET i = i + 1;
  END WHILE;

  -- Products: 1,000 rows
  SET i = 1;
  WHILE i <= 1000 DO
    INSERT INTO products (name, category, price, stock)
    VALUES (
      CONCAT('Product ', i),
      ELT(FLOOR(RAND()*4)+1, 'Electronics','Apparel','Software','Hardware'),
      ROUND(RAND()*999+1, 2),
      FLOOR(RAND()*1000)
    );
    SET i = i + 1;
  END WHILE;

  -- Orders: 20,000 rows
  SET i = 1;
  WHILE i <= 20000 DO
    INSERT INTO orders (user_id, status, total, created_at)
    VALUES (
      FLOOR(RAND()*5000+1),
      ELT(FLOOR(RAND()*4)+1, 'pending','shipped','delivered','cancelled'),
      ROUND(RAND()*5000+10, 2),
      DATE_SUB(NOW(), INTERVAL FLOOR(RAND()*180) DAY)
    );
    SET i = i + 1;
  END WHILE;

  -- Order items: 50,000 rows
  SET i = 1;
  WHILE i <= 50000 DO
    INSERT INTO order_items (order_id, product_id, quantity, unit_price)
    VALUES (
      FLOOR(RAND()*20000+1),
      FLOOR(RAND()*1000+1),
      FLOOR(RAND()*10+1),
      ROUND(RAND()*500+5, 2)
    );
    SET i = i + 1;
  END WHILE;

END$$
DELIMITER ;

CALL seed_data();
DROP PROCEDURE seed_data;

-- Analyze tables for optimizer stats
ANALYZE TABLE users, products, orders, order_items;

-- Grant privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON labdb.* TO 'labdb'@'%';
FLUSH PRIVILEGES;
