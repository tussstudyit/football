from __future__ import annotations

import os
import sys
import hashlib
import hmac
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from getpass import getpass
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, request, send_file, session
from werkzeug.security import check_password_hash, generate_password_hash

try:
    import mysql.connector
    from mysql.connector import Error as MySQLError
except ImportError:  # The app can show its database connection message if the driver is missing.
    mysql = None
    MySQLError = Exception


ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "change-this-secret-before-deploying")
APP_TZ = ZoneInfo("Asia/Bangkok")


class APIError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status


@contextmanager
def connection():
    if mysql is None:
        raise APIError("Chưa cài mysql-connector-python. Chạy pip install -r requirements.txt.", 503)
    try:
        conn = mysql.connector.connect(
            host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
            port=int(os.environ.get("MYSQL_PORT", "3306")),
            user=os.environ.get("MYSQL_USER", "root"),
            password=os.environ.get("MYSQL_PASSWORD", ""),
            database=os.environ.get("MYSQL_DATABASE", "sannha"),
            autocommit=False,
        )
    except MySQLError as exc:
        raise APIError(f"Không kết nối được MySQL: {exc}", 503) from exc
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def cursor(dictionary: bool = True):
    with connection() as conn:
        cur = conn.cursor(dictionary=dictionary)
        try:
            yield conn, cur
        finally:
            cur.close()


def as_iso(value):
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    return value


def row_dict(row):
    return {key: as_iso(value) for key, value in row.items()}


def api_user(row):
    if not row:
        return None
    return {"id": str(row["id"]), "name": row["name"], "email": row["email"], "role": row["role"]}


def require_user(role: str | None = None):
    user_id = session.get("user_id")
    if not user_id:
        raise APIError("Vui lòng đăng nhập để tiếp tục.", 401)
    with cursor() as (_, cur):
        cur.execute("SELECT id, name, email, role FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
    if not user:
        session.clear()
        raise APIError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", 401)
    if role and user["role"] != role:
        raise APIError("Bạn không có quyền thực hiện thao tác này.", 403)
    return user


def get_owned_team(user_id, team_id=None):
    with cursor() as (_, cur):
        if team_id:
            cur.execute("SELECT id, name, members_count AS members, owner_user_id AS owner_id FROM teams WHERE id = %s AND owner_user_id = %s", (team_id, user_id))
        else:
            cur.execute("SELECT id, name, members_count AS members, owner_user_id AS owner_id FROM teams WHERE owner_user_id = %s ORDER BY id LIMIT 1", (user_id,))
        row = cur.fetchone()
    return row


def require_json():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise APIError("Dữ liệu gửi lên không hợp lệ.")
    return payload


def parse_date(value):
    try:
        parsed = date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise APIError("Ngày chưa hợp lệ.")
    if parsed < datetime.now(APP_TZ).date():
        raise APIError("Ngày thi đấu phải từ hôm nay trở đi.")
    return parsed


def parse_time(value):
    try:
        parsed = time.fromisoformat(str(value)[:5])
    except (TypeError, ValueError):
        raise APIError("Giờ chưa hợp lệ.")
    if parsed.minute != 0 or not 16 <= parsed.hour <= 21:
        raise APIError("Khung giờ hợp lệ từ 16:00 đến 21:00.")
    return parsed


def ensure_future(event_date, start):
    scheduled_at = datetime.combine(event_date, start).replace(tzinfo=APP_TZ)
    if scheduled_at <= datetime.now(APP_TZ):
        raise APIError("Giờ thi đấu phải ở thời điểm hiện tại hoặc trong tương lai.")


def check_pitch_available(cur, pitch_id, event_date, start, ignore_booking_id=None, ignore_friendly_id=None):
    ensure_future(event_date, start)
    cur.execute("SELECT id FROM pitches WHERE id = %s AND is_active = 1 FOR UPDATE", (pitch_id,))
    if not cur.fetchone():
        raise APIError("Không tìm thấy sân đang hoạt động.", 404)
    end = (datetime.combine(event_date, start) + timedelta(hours=1)).time()
    booking_sql = """SELECT id FROM bookings WHERE pitch_id = %s AND booking_date = %s AND status = 'confirmed'
                     AND start_time < %s AND end_time > %s"""
    params = [pitch_id, event_date, end, start]
    if ignore_booking_id is not None:
        booking_sql += " AND id <> %s"
        params.append(ignore_booking_id)
    cur.execute(booking_sql + " LIMIT 1", tuple(params))
    if cur.fetchone():
        raise APIError("Sân đã có lịch trong khung giờ này. Hãy chọn giờ khác.", 409)
    friendly_sql = """SELECT id FROM friendlies WHERE pitch_id = %s AND match_date = %s
                      AND status IN ('pending','accepted','reschedule_proposed','confirmed') AND match_time = %s"""
    friendly_params = [pitch_id, event_date, start]
    if ignore_friendly_id is not None:
        friendly_sql += " AND id <> %s"
        friendly_params.append(ignore_friendly_id)
    cur.execute(friendly_sql + " LIMIT 1", tuple(friendly_params))
    if cur.fetchone():
        raise APIError("Khung giờ này đang có lịch giao hữu.", 409)


@app.errorhandler(APIError)
def handle_api_error(error):
    return jsonify({"error": error.message}), error.status


@app.errorhandler(MySQLError)
def handle_mysql_error(error):
    return jsonify({"error": f"Lỗi MySQL: {error}"}), 503


@app.get("/")
def index():
    return send_file(ROOT / "index.html")


@app.get("/api/bootstrap")
def bootstrap():
    with cursor() as (_, cur):
        cur.execute("SELECT id, name, location, size, price_per_hour, features FROM pitches WHERE is_active = 1 ORDER BY id")
        pitches = []
        for index, row in enumerate(cur.fetchall()):
            pitches.append({
                "id": str(row["id"]), "name": row["name"], "location": row["location"], "size": row["size"],
                "price": int(row["price_per_hour"]),
                "features": [feature.strip() for feature in (row["features"] or "").split(",") if feature.strip()],
                "variant": f"v{index + 1}",
            })
        cur.execute("SELECT id, name, members_count AS members, owner_user_id AS owner_id FROM teams WHERE owner_user_id IS NOT NULL ORDER BY id")
        teams = [{**row_dict(row), "id": str(row["id"]), "owner_id": str(row["owner_id"]) if row["owner_id"] else None} for row in cur.fetchall()]
        cur.execute("""SELECT b.id, b.pitch_id, b.user_id, b.team_name AS team, b.booking_date AS date,
                       b.start_time, b.end_time, b.status FROM bookings b ORDER BY b.booking_date DESC, b.start_time""")
        bookings = []
        for row in cur.fetchall():
            item = row_dict(row)
            item["id"] = str(item["id"])
            item["pitch_id"] = str(item["pitch_id"])
            item["user_id"] = str(item["user_id"]) if item["user_id"] else "admin"
            item["start_time"] = item["start_time"][:5]
            item["end_time"] = item["end_time"][:5]
            item["date"] = str(item["date"])
            bookings.append(item)
        cur.execute("""SELECT f.id, f.home_team_id, f.away_team_id, f.pitch_id, f.match_date AS date,
                       f.match_time AS time, f.status, f.created_by_team_id FROM friendlies f
                       ORDER BY f.match_date DESC, f.match_time""")
        friendlies = []
        for row in cur.fetchall():
            item = row_dict(row)
            for key in ("id", "home_team_id", "away_team_id", "pitch_id", "created_by_team_id"):
                item[key] = str(item[key]) if item[key] is not None else None
            item["date"] = str(item["date"])
            item["time"] = item["time"][:5]
            friendlies.append(item)
        current = None
        if session.get("user_id"):
            cur.execute("SELECT id, name, email, role FROM users WHERE id = %s", (session["user_id"],))
            current = api_user(cur.fetchone())
    return jsonify({"pitches": pitches, "teams": teams, "bookings": bookings, "friendlies": friendlies, "current_user": current})


@app.post("/api/auth/register")
def register():
    body = require_json()
    name, email, password = (str(body.get(key, "")).strip() for key in ("name", "email", "password"))
    team_name = str(body.get("team", "")).strip()
    if not name or not email or len(password) < 6:
        raise APIError("Vui lòng nhập họ tên, email và mật khẩu ít nhất 6 ký tự.")
    with cursor() as (conn, cur):
        cur.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cur.fetchone():
            raise APIError("Email này đã được đăng ký.", 409)
        cur.execute("INSERT INTO users (name, email, password_hash, role) VALUES (%s, %s, %s, 'user')", (name, email, generate_password_hash(password)))
        user_id = cur.lastrowid
        if team_name:
            cur.execute("INSERT INTO teams (name, owner_user_id, members_count) VALUES (%s, %s, 1)", (team_name, user_id))
        conn.commit()
        cur.execute("SELECT id, name, email, role FROM users WHERE id = %s", (user_id,))
        user = api_user(cur.fetchone())
    session["user_id"] = int(user["id"])
    return jsonify({"user": user}), 201


@app.post("/api/auth/login")
def login():
    body = require_json()
    email = str(body.get("email", "")).strip()
    password = str(body.get("password", ""))
    with cursor() as (_, cur):
        cur.execute("SELECT id, name, email, role, password_hash FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
    if not row:
        raise APIError("Email hoặc mật khẩu chưa chính xác.", 401)
    stored_hash = row["password_hash"]
    if stored_hash.startswith("sql-sha256$"):
        try:
            _, salt, digest = stored_hash.split("$", 2)
            candidate = hashlib.sha256(f"{salt}{password}".encode("utf-8")).hexdigest()
            valid_password = hmac.compare_digest(candidate, digest)
        except ValueError:
            valid_password = False
        if not valid_password:
            raise APIError("Email hoặc mật khẩu chưa chính xác.", 401)
        with cursor() as (conn, cur):
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (generate_password_hash(password), row["id"]))
            conn.commit()
    elif not check_password_hash(stored_hash, password):
        raise APIError("Email hoặc mật khẩu chưa chính xác.", 401)
    session["user_id"] = int(row["id"])
    return jsonify({"user": api_user(row)})


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.post("/api/teams")
def create_team():
    user = require_user("user")
    name = str(require_json().get("name", "")).strip()
    if not name:
        raise APIError("Hãy nhập tên đội bóng.")
    with cursor() as (conn, cur):
        cur.execute("SELECT id FROM teams WHERE owner_user_id = %s", (user["id"],))
        if cur.fetchone():
            raise APIError("Tài khoản của bạn đã có đội bóng.", 409)
        cur.execute("INSERT INTO teams (name, owner_user_id, members_count) VALUES (%s, %s, 1)", (name, user["id"]))
        conn.commit()
    return jsonify({"ok": True}), 201


@app.post("/api/bookings")
def create_booking():
    user = require_user("user")
    body = require_json()
    pitch_id = body.get("pitch_id")
    event_date = parse_date(body.get("date"))
    start = parse_time(body.get("time"))
    team = str(body.get("team", "")).strip()
    if not team:
        raise APIError("Hãy nhập tên đội đặt sân.")
    end = (datetime.combine(event_date, start) + timedelta(hours=1)).time()
    with cursor() as (conn, cur):
        check_pitch_available(cur, pitch_id, event_date, start)
        cur.execute("INSERT INTO bookings (pitch_id, user_id, team_name, booking_date, start_time, end_time, status) VALUES (%s,%s,%s,%s,%s,%s,'confirmed')", (pitch_id, user["id"], team, event_date, start, end))
        conn.commit()
    return jsonify({"ok": True}), 201


@app.post("/api/admin/bookings")
def admin_create_booking():
    require_user("admin")
    body = require_json()
    pitch_id = body.get("pitch_id")
    event_date = parse_date(body.get("date"))
    start = parse_time(body.get("time"))
    team = str(body.get("team", "")).strip()
    if not team:
        raise APIError("Hãy nhập tên đội đặt sân.")
    end = (datetime.combine(event_date, start) + timedelta(hours=1)).time()
    with cursor() as (conn, cur):
        check_pitch_available(cur, pitch_id, event_date, start)
        cur.execute("INSERT INTO bookings (pitch_id, user_id, team_name, booking_date, start_time, end_time, status) VALUES (%s,NULL,%s,%s,%s,%s,'confirmed')", (pitch_id, team, event_date, start, end))
        conn.commit()
    return jsonify({"ok": True}), 201


@app.patch("/api/admin/bookings/<int:booking_id>")
def admin_update_booking(booking_id):
    require_user("admin")
    status = require_json().get("status")
    if status not in ("confirmed", "cancelled"):
        raise APIError("Trạng thái lịch sân chưa hợp lệ.")
    with cursor() as (conn, cur):
        cur.execute("SELECT pitch_id, booking_date, start_time FROM bookings WHERE id = %s FOR UPDATE", (booking_id,))
        booking = cur.fetchone()
        if not booking:
            raise APIError("Không tìm thấy lịch sân.", 404)
        if status == "confirmed":
            check_pitch_available(cur, booking["pitch_id"], booking["booking_date"], booking["start_time"], ignore_booking_id=booking_id)
        cur.execute("UPDATE bookings SET status = %s WHERE id = %s", (status, booking_id))
        conn.commit()
    return jsonify({"ok": True})


@app.post("/api/friendlies")
def create_friendly():
    user = require_user("user")
    body = require_json()
    own_team = get_owned_team(user["id"])
    if not own_team:
        raise APIError("Hãy tạo đội bóng trong hồ sơ trước khi gửi lời mời.")
    opponent_id = body.get("opponent_team_id")
    if not opponent_id or str(opponent_id) == str(own_team["id"]):
        raise APIError("Hãy chọn một đội bóng khác.")
    event_date = parse_date(body.get("date"))
    match_time = parse_time(body.get("time"))
    ensure_future(event_date, match_time)
    pitch_id = body.get("pitch_id") or None
    with cursor() as (conn, cur):
        cur.execute("SELECT id FROM teams WHERE id = %s AND owner_user_id IS NOT NULL", (opponent_id,))
        if not cur.fetchone():
            raise APIError("Không tìm thấy đội được mời.", 404)
        if pitch_id:
            check_pitch_available(cur, pitch_id, event_date, match_time)
        cur.execute("INSERT INTO friendlies (home_team_id, away_team_id, pitch_id, match_date, match_time, status, created_by_team_id, created_by_user_id) VALUES (%s,%s,%s,%s,%s,'pending',%s,%s)", (own_team["id"], opponent_id, pitch_id, event_date, match_time, own_team["id"], user["id"]))
        conn.commit()
    return jsonify({"ok": True}), 201


@app.patch("/api/admin/friendlies/<int:friendly_id>/schedule")
def admin_schedule_friendly(friendly_id):
    require_user("admin")
    body = require_json()
    event_date = parse_date(body.get("date"))
    match_time = parse_time(body.get("time"))
    pitch_id = body.get("pitch_id")
    if not pitch_id:
        raise APIError("Chọn sân trước khi lưu lịch.")
    with cursor() as (conn, cur):
        cur.execute("SELECT status, pitch_id FROM friendlies WHERE id = %s FOR UPDATE", (friendly_id,))
        match = cur.fetchone()
        if not match:
            raise APIError("Không tìm thấy lịch giao hữu.", 404)
        if match["status"] not in ("pending", "reschedule_proposed", "accepted", "confirmed"):
            raise APIError("Lịch giao hữu này không thể xếp lại.", 409)
        check_pitch_available(cur, pitch_id, event_date, match_time, ignore_friendly_id=friendly_id)
        next_status = "reschedule_proposed" if match["status"] in ("accepted", "confirmed", "reschedule_proposed") else "pending"
        cur.execute("UPDATE friendlies SET pitch_id = %s, match_date = %s, match_time = %s, status = %s WHERE id = %s", (pitch_id, event_date, match_time, next_status, friendly_id))
        conn.commit()
    return jsonify({"ok": True})


@app.post("/api/admin/friendlies/random")
def random_friendly():
    admin = require_user("admin")
    body = require_json()
    event_date = parse_date(body.get("date"))
    match_time = parse_time(body.get("time"))
    pitch_id = body.get("pitch_id")
    with cursor() as (conn, cur):
        cur.execute(
            """SELECT t.id FROM teams t WHERE t.owner_user_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM friendlies f
                 WHERE (f.home_team_id = t.id OR f.away_team_id = t.id)
                   AND f.match_date = %s AND f.match_time = %s
                   AND f.status IN ('pending','accepted','reschedule_proposed','confirmed')
               ) ORDER BY RAND() LIMIT 2""",
            (event_date, match_time),
        )
        teams = cur.fetchall()
        if len(teams) < 2:
            raise APIError("Cần có ít nhất hai đội trong hệ thống để ghép giao hữu.")
        check_pitch_available(cur, pitch_id, event_date, match_time)
        cur.execute("INSERT INTO friendlies (home_team_id, away_team_id, pitch_id, match_date, match_time, status, created_by_team_id, created_by_user_id) VALUES (%s,%s,%s,%s,%s,'pending',%s,%s)", (teams[0]["id"], teams[1]["id"], pitch_id, event_date, match_time, teams[0]["id"], admin["id"]))
        conn.commit()
    return jsonify({"ok": True}), 201


@app.patch("/api/friendlies/<int:friendly_id>")
def update_friendly(friendly_id):
    user = require_user()
    body = require_json()
    action = body.get("action")
    status_map = {"accept": "accepted", "confirm": "confirmed", "decline": "declined", "cancel": "cancelled", "reschedule": "reschedule_proposed"}
    if action not in status_map:
        raise APIError("Thao tác chưa hợp lệ.")
    with cursor() as (conn, cur):
        cur.execute("SELECT id, home_team_id, away_team_id, pitch_id, match_date, match_time, created_by_team_id FROM friendlies WHERE id = %s FOR UPDATE", (friendly_id,))
        match = cur.fetchone()
        if not match:
            raise APIError("Không tìm thấy lịch giao hữu.", 404)
        if user["role"] == "admin":
            can_respond = action == "decline" and match["status"] in ("pending", "reschedule_proposed")
            can_confirm = action == "confirm" and match["status"] == "accepted"
            can_cancel = action == "cancel" and match["status"] in ("accepted", "confirmed")
            if not (can_respond or can_confirm or can_cancel):
                raise APIError("Thao tác này không phù hợp với trạng thái giao hữu.", 409)
            if action == "confirm":
                if not match["pitch_id"]:
                    raise APIError("Trước khi xác nhận, hãy xếp sân và giờ cho trận giao hữu.", 409)
                check_pitch_available(cur, match["pitch_id"], match["match_date"], match["match_time"], ignore_friendly_id=friendly_id)
        else:
            owned = get_owned_team(user["id"])
            if not owned or int(owned["id"]) not in (match["home_team_id"], match["away_team_id"]):
                raise APIError("Lịch này không thuộc đội của bạn.", 403)
            creator_id = match["created_by_team_id"]
            is_creator = creator_id is not None and int(owned["id"]) == creator_id
            if match["status"] == "pending":
                if action not in ("accept", "decline", "reschedule") or is_creator:
                    raise APIError("Chỉ đội được mời mới có thể phản hồi lịch này.", 403)
            elif match["status"] == "reschedule_proposed":
                if action not in ("accept", "decline") or (not is_creator and creator_id is not None):
                    raise APIError("Đội gửi lời mời mới có thể xác nhận hoặc từ chối giờ đề xuất.", 403)
            else:
                raise APIError("Lời mời này đã được xử lý.", 409)
        updates = {"status": status_map[action]}
        if action == "reschedule":
            if body.get("date"):
                updates["match_date"] = parse_date(body.get("date"))
            if body.get("time"):
                updates["match_time"] = parse_time(body.get("time"))
            ensure_future(updates.get("match_date", match["match_date"]), updates.get("match_time", match["match_time"]))
            if match["pitch_id"]:
                check_pitch_available(
                    cur,
                    match["pitch_id"],
                    updates.get("match_date", match["match_date"]),
                    updates.get("match_time", match["match_time"]),
                    ignore_friendly_id=friendly_id,
                )
        if action == "accept" and (body.get("date") or body.get("time")):
            if body.get("date"):
                updates["match_date"] = parse_date(body.get("date"))
            if body.get("time"):
                updates["match_time"] = parse_time(body.get("time"))
        if action == "accept":
            ensure_future(updates.get("match_date", match["match_date"]), updates.get("match_time", match["match_time"]))
        if action == "accept" and match["pitch_id"]:
            check_pitch_available(
                cur,
                match["pitch_id"],
                updates.get("match_date", match["match_date"]),
                updates.get("match_time", match["match_time"]),
                ignore_friendly_id=friendly_id,
            )
        cur.execute("UPDATE friendlies SET status = %s, match_date = %s, match_time = %s WHERE id = %s", (updates["status"], updates.get("match_date", match["match_date"]), updates.get("match_time", match["match_time"]), friendly_id))
        conn.commit()
    return jsonify({"ok": True})


def create_admin_cli():
    name = input("Tên admin: ").strip()
    email = input("Email admin: ").strip()
    password = getpass("Mật khẩu (ít nhất 6 ký tự): ")
    password_confirm = getpass("Nhập lại mật khẩu: ")

    if not name or "@" not in email:
        print("Tên và email hợp lệ là bắt buộc.", file=sys.stderr)
        raise SystemExit(1)
    if len(password) < 6:
        print("Mật khẩu cần có ít nhất 6 ký tự.", file=sys.stderr)
        raise SystemExit(1)
    if password != password_confirm:
        print("Hai mật khẩu không trùng nhau.", file=sys.stderr)
        raise SystemExit(1)

    try:
        with cursor() as (conn, cur):
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            if cur.fetchone():
                print("Email đã có tài khoản. Dùng câu lệnh UPDATE trong README để nâng quyền tài khoản đó.", file=sys.stderr)
                raise SystemExit(1)
            cur.execute(
                "INSERT INTO users (name, email, password_hash, role) VALUES (%s, %s, %s, 'admin')",
                (name, email, generate_password_hash(password)),
            )
            conn.commit()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"Không tạo được admin: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    print(f"Đã tạo tài khoản admin cho {email}.")


if __name__ == "__main__":
    if "--create-admin" in sys.argv:
        create_admin_cli()
    elif "--init-db" in sys.argv:
        with connection() as conn:
            with conn.cursor() as cur:
                schema = (ROOT / "football.sql").read_text(encoding="utf-8")
                for statement in schema.split(";"):
                    clean = statement.strip()
                    if clean and not clean.startswith("--"):
                        cur.execute(clean)
            conn.commit()
        print("Đã tạo cấu trúc Sân Nhà trong MySQL.")
    else:
        app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=True)
