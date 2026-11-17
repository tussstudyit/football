# Sân Nhà

Website đặt sân và kết nối giao hữu, xây bằng HTML/CSS/JavaScript, Python Flask và MySQL. Ứng dụng cần kết nối MySQL để đăng nhập và thực hiện chức năng; dữ liệu lấy từ cơ sở dữ liệu, không lưu giả trên trình duyệt.

## Cài đặt và chạy

1. Bật **MySQL** trong XAMPP Control Panel.
2. Mở phpMyAdmin và import `football.sql`. Database `sannha`, các bảng và sáu bản ghi sân khởi tạo sẽ được tạo.
3. Tại `D:\football`, cài thư viện và khởi động Flask:

   ```powershell
   # Python 3.9 trở lên
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   py app.py
   ```

4. Mở `http://127.0.0.1:5000` — không mở trực tiếp `index.html`.

Mặc định ứng dụng dùng MySQL tại `127.0.0.1:3306`, tài khoản `root`, mật khẩu rỗng và database `sannha`. Có thể đặt thông tin kết nối khác trước khi chạy:

```powershell
$env:MYSQL_HOST = "127.0.0.1"
$env:MYSQL_PORT = "3306"
$env:MYSQL_USER = "root"
$env:MYSQL_PASSWORD = "mat-khau-mysql"
$env:MYSQL_DATABASE = "sannha"
$env:FLASK_SECRET_KEY = "chuoi-bi-mat-cua-rieng-ban"
py app.py
```

## Phân quyền

- **User:** đăng ký/đăng nhập; xem sân còn trống theo ngày và giờ; đặt sân; xem trạng thái đặt; tạo đội; gửi lời mời giao hữu; nhận lời, từ chối hoặc đề xuất lịch khác; xem lịch sử của đội trong hồ sơ.
- **Admin:** quản lý lịch đặt sân và chuyển trạng thái giữa đã đặt/trống; tạo lịch sân; ghép ngẫu nhiên hai đội theo sân/ngày/giờ; xếp hoặc đổi sân/giờ cho lời mời; xác nhận, từ chối hoặc hủy lịch giao hữu đã nhận lời.

Đăng ký tài khoản mới luôn tạo quyền `user`. Để tạo tài khoản admin trực tiếp trong phpMyAdmin, thay tên, email và mật khẩu mẫu trong các biến dưới đây rồi chạy cả khối SQL:

```sql
USE sannha;
SET @admin_name = 'Quản trị viên';
SET @admin_email = 'admin@football.local';
SET @admin_password = 'ThayBangMatKhauManh_2026!';
SET @admin_salt = REPLACE(UUID(), '-', '');

INSERT INTO users (name, email, password_hash, role)
VALUES (
  @admin_name,
  @admin_email,
  CONCAT('sql-sha256$', @admin_salt, '$', SHA2(CONCAT(@admin_salt, @admin_password), 256)),
  'admin'
);
```

Khi đăng nhập thành công lần đầu, ứng dụng tự chuyển mật khẩu sang dạng băm Werkzeug. Nếu email đã tồn tại, dùng câu lệnh `UPDATE` bên dưới để nâng quyền tài khoản đó.

Bạn cũng có thể tạo admin bằng lệnh PowerShell (lệnh sẽ hỏi tên, email và mật khẩu):

```powershell
.\.venv\Scripts\python.exe app.py --create-admin
```

Mật khẩu được băm trước khi lưu. Nếu email đã có tài khoản, lệnh sẽ dừng; để nâng quyền tài khoản đó, chạy trong phpMyAdmin:

```sql
USE sannha;
UPDATE users SET role = 'admin' WHERE email = 'email-cua-ban@example.com';
```

Đăng xuất rồi đăng nhập lại để nhận quyền mới. Mỗi tài khoản tạo một đội trong lúc đăng ký hoặc mục **Hồ sơ**. Ghép ngẫu nhiên cần tối thiểu hai đội có tài khoản sở hữu.

Nếu database được tạo bằng phiên bản SQL cũ, chạy câu lệnh sau trong phpMyAdmin để cho phép admin hủy trận đã nhận lời:

```sql
USE sannha;
ALTER TABLE friendlies MODIFY status ENUM('pending','accepted','declined','cancelled','reschedule_proposed','confirmed','completed') NOT NULL DEFAULT 'pending';
```

Các sân khởi tạo trong `football.sql` là dữ liệu cấu hình ban đầu; thay tên, địa điểm và giá bằng thông tin sân thực tế trong phpMyAdmin.
# football
