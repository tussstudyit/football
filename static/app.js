const SLOT_TIMES = ['16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const isoDate = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const addDays = (date, days) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return isoDate(d); };
const money = value => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const dateLabel = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Chưa xếp lịch';
const initials = value => (value || '?').trim().split(/\s+/).slice(-2).map(s => s[0]).join('').toUpperCase();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

let data = { pitches: [], teams: [], bookings: [], friendlies: [] };
let currentUser = null;
let apiLive = false;
let apiError = '';
let activeView = 'home';
let selectedDate = isoDate();
let selectedArea = 'all';
let selectedSize = 'all';
let activeAdminTab = 'bookings';
let pendingBooking = null;
let toastTimer = null;

function teamById(id) { return data.teams.find(team => String(team.id) === String(id)); }
function pitchById(id) { return data.pitches.find(pitch => String(pitch.id) === String(id)); }
function userTeam() { return data.teams.find(team => String(team.owner_id) === String(currentUser?.id)); }
function statusText(status) { return ({ pending: 'Chờ xác nhận', confirmed: 'Đã đặt', accepted: 'Đã nhận lời', declined: 'Đã từ chối', cancelled: 'Đã hủy', reschedule_proposed: 'Đề xuất đổi lịch', completed: 'Đã đá' })[status] || status || 'Chưa cập nhật'; }
function teamCanRespond(match) {
  const team = userTeam();
  if (!team || ![String(match.home_team_id), String(match.away_team_id)].includes(String(team.id))) return false;
  if (match.status === 'pending') return !match.created_by_team_id || String(team.id) !== String(match.created_by_team_id);
  if (match.status === 'reschedule_proposed') return !match.created_by_team_id || String(team.id) === String(match.created_by_team_id);
  return false;
}
function myBookings() { return data.bookings.filter(item => String(item.user_id) === String(currentUser?.id)); }
function myFriendlies() { const team = userTeam(); return team ? data.friendlies.filter(match => [String(match.home_team_id), String(match.away_team_id)].includes(String(team.id))) : []; }

async function requestApi(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(payload.error || `Lỗi máy chủ (${response.status})`);
  return payload;
}
async function refreshFromApi() {
  const payload = await requestApi('/api/bootstrap');
  data = {
    pitches: Array.isArray(payload.pitches) ? payload.pitches : [],
    teams: Array.isArray(payload.teams) ? payload.teams : [],
    bookings: Array.isArray(payload.bookings) ? payload.bookings : [],
    friendlies: Array.isArray(payload.friendlies) ? payload.friendlies : []
  };
  if (payload.current_user !== undefined) {
    currentUser = payload.current_user;
  }
  apiLive = true;
  apiError = '';
  updateHeader();
  return payload;
}
async function init() {
  try { await refreshFromApi(); }
  catch (error) { apiLive = false; apiError = error.message || 'Không kết nối được máy chủ.'; }
  updateHeader();
  render();
}

function updateHeader() {
  const badge = $('#apiBadge');
  badge?.classList.toggle('live', apiLive);
  if (badge) badge.innerHTML = `<i></i> ${apiLive ? 'Đã kết nối hệ thống' : 'Chưa kết nối hệ thống'}`;
  const account = $('#accountButton');
  if (account) {
    account.innerHTML = currentUser
      ? `<span class="avatar mini">${escapeHtml(initials(currentUser.name))}</span><span class="account-label">${escapeHtml(currentUser.name)}</span>`
      : '<span class="avatar mini">?</span><span class="account-label">Đăng nhập</span>';
    account.dataset.action = currentUser ? 'profile' : 'auth';
  }
  $$('.admin-link').forEach(link => link.classList.toggle('hidden', currentUser?.role !== 'admin'));
}
function setView(view) {
  if (view === 'admin' && currentUser?.role !== 'admin') { showToast('Khu vực này chỉ dành cho admin.'); return; }
  activeView = view;
  $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === view));
  $('.main-nav')?.classList.remove('open');
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function render() {
  updateHeader();
  const root = $('#viewRoot');
  if (!root) return;
  if (apiError) {
    root.innerHTML = `<div class="page-shell"><section class="panel empty-state"><div class="empty-icon">⚠</div><h3>Chưa kết nối được hệ thống</h3><p>${escapeHtml(apiError)}<br>Hãy bật MySQL trong XAMPP và chạy máy chủ Sân Nhà, sau đó thử kết nối lại.</p><button class="button-primary" data-action="retry-connect" style="margin-top:16px">Thử kết nối lại</button></section></div>`;
    return;
  }
  if (activeView === 'booking') root.innerHTML = renderBooking();
  else if (activeView === 'friendly') root.innerHTML = renderFriendly();
  else if (activeView === 'profile') root.innerHTML = renderProfile();
  else if (activeView === 'admin') root.innerHTML = renderAdmin();
  else root.innerHTML = renderHome();
  if (activeView === 'profile' && currentUser?.role === 'admin') $('[data-action="create-team"]', root)?.remove();
}

function pitchCard(pitch) {
  return `<article class="pitch-card">
    <div class="pitch-visual ${escapeHtml(pitch.variant || 'v1')}"><span class="floodlight"></span><span class="floodlight second"></span><span class="pitch-tag">${escapeHtml(pitch.size || 'Sân 5')}</span><span class="pitch-price-tag">${money(pitch.price)} / giờ</span></div>
    <div class="pitch-body"><div class="pitch-titleline"><h3>${escapeHtml(pitch.name)}</h3></div>
      <p class="pitch-location">⌖ &nbsp;${escapeHtml(pitch.location || 'Gần bạn')}</p><div class="feature-list">${(pitch.features || []).slice(0, 3).map(item => `<span class="feature-pill">${escapeHtml(item)}</span>`).join('')}</div>
      <div class="pitch-actions"><small>● Sân đang nhận lịch</small><button class="button-primary" data-action="go-booking" data-pitch="${escapeHtml(pitch.id)}">Xem giờ trống&nbsp; →</button></div></div>
  </article>`;
}

function renderHome() {
  const topPitches = data.pitches.slice(0, 3);
  const available = data.pitches.length;
  const upcoming = data.friendlies.filter(item => item.date >= isoDate() && ['pending', 'accepted', 'reschedule_proposed'].includes(item.status)).slice(0, 2);
  return `<section class="hero"><div class="hero-inner"><span class="eyebrow">Cộng đồng bóng đá quanh bạn</span><h1>Ra sân thôi.<br><em>Trận hay bắt đầu từ đây.</em></h1><p>Tìm sân nhanh, hẹn đội giao hữu và giữ trọn đam mê cùng Sân Nhà.</p>
    <form id="heroSearch" class="search-panel"><div class="search-field"><label for="heroDate">Ngày chơi</label><input id="heroDate" name="date" type="date" value="${selectedDate}" required></div><div class="search-field"><label for="heroSize">Loại sân</label><select id="heroSize" name="size"><option value="all">Tất cả loại sân</option><option>Sân 5</option><option>Sân 7</option></select></div><div class="search-field"><label for="heroArea">Khu vực</label><select id="heroArea" name="area"><option value="all">Mọi khu vực</option><option>Bình Thạnh</option><option>Phú Nhuận</option><option>Gò Vấp</option></select></div><button class="button-primary search-button">Tìm sân trống &nbsp;→</button></form>
    <div class="hero-footnote">✓ Không phí tìm kiếm &nbsp; · &nbsp; ✓ Xác nhận lịch nhanh &nbsp; · &nbsp; ✓ Tìm đối giao hữu</div>
  </div></section>
  <section class="section"><div class="content-wrap"><div class="section-head"><div><span class="eyebrow">Chọn sân phù hợp</span><h2>Sân nổi bật</h2><p>Mặt sân đẹp, mức giá rõ ràng, sẵn sàng cho trận tiếp theo.</p></div><button class="text-link" data-view="booking">Xem tất cả sân&nbsp; →</button></div><div class="pitch-grid">${topPitches.map(pitchCard).join('')}</div>
    <div class="stats-strip"><div class="stat-card"><strong>${available}</strong><span><i class="stat-dot"></i>Sân trong hệ thống</span></div><div class="stat-card"><strong>${data.teams.length}</strong><span>Đội bóng đã đăng ký</span></div><div class="stat-card"><strong>${data.bookings.filter(item => item.status === 'confirmed').length}</strong><span>Lịch sân đã xác nhận</span></div><div class="stat-card"><strong>${data.friendlies.length}</strong><span>Lịch giao hữu</span></div></div>
  </div></section>
  <section class="section compact"><div class="content-wrap"><div class="promo-band"><div><h3>Tìm đối giao hữu cho đội của bạn</h3><p>Gửi lời mời, thống nhất thời gian và cùng nhau ra sân.</p></div><button class="button-primary" data-view="friendly">Khám phá giao hữu&nbsp; →</button></div></div></section>
  <section class="section"><div class="content-wrap"><div class="section-head"><div><span class="eyebrow">Gặp nhau trên sân</span><h2>Lịch giao hữu sắp tới</h2><p>Những cuộc hẹn đang chờ đội bóng của bạn.</p></div><button class="text-link" data-view="friendly">Xem lịch giao hữu&nbsp; →</button></div>${upcoming.length ? `<div class="match-grid">${upcoming.map(matchCard).join('')}</div>` : `<div class="panel empty-state"><div class="empty-icon">⚽</div><h3>Chưa có lịch giao hữu sắp tới</h3><p>Vào mục giao hữu để tìm đội và tạo cuộc hẹn mới.</p></div>`}</div></section>`;
}

function statusFor(pitchId, date, time) {
  const booking = data.bookings.find(item => String(item.pitch_id) === String(pitchId) && item.date === date && item.start_time?.slice(0, 5) === time && !['cancelled', 'declined'].includes(item.status));
  if (booking) return { kind: String(booking.user_id) === String(currentUser?.id) ? 'mine' : 'busy', label: String(booking.user_id) === String(currentUser?.id) ? 'Sân của bạn' : 'Đã đặt', item: booking };
  const match = data.friendlies.find(item => String(item.pitch_id) === String(pitchId) && item.date === date && item.time?.slice(0, 5) === time && ['pending', 'accepted', 'reschedule_proposed', 'confirmed'].includes(item.status));
  if (match) return { kind: 'friendly', label: 'Giao hữu', item: match };
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (date < isoDate() || (date === isoDate() && time <= currentTime)) return { kind: 'past', label: 'Đã qua', item: null };
  return { kind: 'open', label: 'Còn trống', item: null };
}
function renderBooking() {
  const shown = data.pitches.filter(pitch => (selectedArea === 'all' || (pitch.location || '').includes(selectedArea)) && (selectedSize === 'all' || pitch.size === selectedSize));
  return `<div class="page-shell"><div class="page-heading"><div><span class="eyebrow">Lịch sân theo giờ</span><h1>Đặt sân bóng</h1><p>Chọn ngày, xem trạng thái từng khung giờ và đặt sân chỉ trong vài bước.</p></div><div class="heading-actions"><button class="button-outline" data-view="friendly">⚽ Tìm đối giao hữu</button></div></div>
    <div class="booking-layout"><section class="panel"><div class="filter-bar"><div class="field"><label for="bookingDate">Ngày chơi</label><input id="bookingDate" type="date" value="${selectedDate}"></div><div class="field"><label for="areaFilter">Khu vực</label><select id="areaFilter"><option value="all" ${selectedArea === 'all' ? 'selected' : ''}>Tất cả khu vực</option><option ${selectedArea === 'Bình Thạnh' ? 'selected' : ''}>Bình Thạnh</option><option ${selectedArea === 'Phú Nhuận' ? 'selected' : ''}>Phú Nhuận</option><option ${selectedArea === 'Gò Vấp' ? 'selected' : ''}>Gò Vấp</option></select></div><div class="field"><label for="sizeFilter">Loại sân</label><select id="sizeFilter"><option value="all" ${selectedSize === 'all' ? 'selected' : ''}>Tất cả sân</option><option ${selectedSize === 'Sân 5' ? 'selected' : ''}>Sân 5</option><option ${selectedSize === 'Sân 7' ? 'selected' : ''}>Sân 7</option></select></div><button class="button-primary" data-action="apply-filter">Tìm sân trống&nbsp;⌕</button></div>
      <div class="legend"><span><i></i>Còn trống</span><span><i class="busy"></i>Đã đặt</span><span><i class="friendly"></i>Giao hữu</span></div>
      <div class="slot-table-wrap"><table class="slot-table"><thead><tr><th>Sân / Giờ</th>${SLOT_TIMES.map(time => `<th>${time} – ${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}:00</th>`).join('')}</tr></thead><tbody>${shown.map(pitch => `<tr><td><strong>${escapeHtml(pitch.name)}</strong><small>${escapeHtml(pitch.size || '')} · ${money(pitch.price)}/giờ</small></td>${SLOT_TIMES.map(time => { const slot = statusFor(pitch.id, selectedDate, time); return `<td><button class="slot-slot ${slot.kind}" ${slot.kind !== 'open' ? 'disabled' : ''} data-action="book-slot" data-pitch="${escapeHtml(pitch.id)}" data-time="${time}">${slot.kind === 'open' ? `＋ ${money(pitch.price)}` : escapeHtml(slot.label)}</button></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      ${shown.length ? '' : '<div class="empty-state"><h3>Không tìm thấy sân phù hợp</h3><p>Thử đổi khu vực hoặc loại sân nhé.</p></div>'}</section>
      <aside class="panel side-panel"><h3>Thông tin nhanh</h3><div class="quick-stat"><span class="quick-icon">🗓</span><div><strong>${dateLabel(selectedDate)}</strong><small>Ngày đang xem</small></div></div><div class="quick-stat"><span class="quick-icon">🏟</span><div><strong>${shown.length} sân phù hợp</strong><small>Đang hiển thị</small></div></div><div class="quick-stat"><span class="quick-icon">🕒</span><div><strong>${SLOT_TIMES.length} khung giờ</strong><small>Từ 16:00 đến 22:00</small></div></div><div class="side-note">Chọn ô màu xanh để giữ chỗ. Lịch đặt được xác nhận ngay và hiển thị trong hồ sơ của bạn.</div></aside></div></div>`;
}

function matchCard(match) {
  const home = teamById(match.home_team_id) || { name: match.home_team_name || 'Đội nhà' };
  const away = teamById(match.away_team_id) || { name: match.away_team_name || 'Đội khách' };
  const pitch = pitchById(match.pitch_id);
  const canRespond = currentUser && (currentUser.role === 'admin' || teamCanRespond(match));
  const userSide = String(userTeam()?.id) === String(match.home_team_id) ? 'home' : 'away';
  const buttons = [];
  if (canRespond && match.status === 'pending' && currentUser.role !== 'admin') {
    buttons.push(`<button class="button-primary" data-action="match-accept" data-id="${escapeHtml(match.id)}">Nhận lời</button><button class="button-outline" data-action="match-reschedule" data-id="${escapeHtml(match.id)}">Đề xuất đổi lịch</button><button class="button-danger" data-action="match-decline" data-id="${escapeHtml(match.id)}">Từ chối</button>`);
  } else if (canRespond && match.status === 'reschedule_proposed' && currentUser.role !== 'admin') {
    buttons.push(`<button class="button-primary" data-action="match-accept" data-id="${escapeHtml(match.id)}">Đồng ý lịch mới</button><button class="button-danger" data-action="match-decline" data-id="${escapeHtml(match.id)}">Từ chối</button>`);
  } else if (currentUser?.role === 'admin' && ['pending', 'reschedule_proposed', 'accepted', 'confirmed'].includes(match.status)) {
    buttons.push(`<button class="button-soft" data-action="admin-schedule-match" data-id="${escapeHtml(match.id)}">Xếp sân / giờ</button>${match.status === 'accepted' && match.pitch_id ? `<button class="button-primary" data-action="admin-match-confirm" data-id="${escapeHtml(match.id)}">Xác nhận</button>` : ''}${['pending', 'reschedule_proposed'].includes(match.status) ? `<button class="button-danger" data-action="match-decline" data-id="${escapeHtml(match.id)}">Từ chối</button>` : `<button class="button-danger" data-action="admin-match-cancel" data-id="${escapeHtml(match.id)}">Hủy lịch</button>`}`);
  }
  if (!currentUser && match.status === 'pending') buttons.push('<button class="button-outline" data-action="auth">Đăng nhập để phản hồi</button>');
  return `<article class="match-card"><div class="match-top"><span class="eyebrow">Lời mời giao hữu</span><span class="match-status ${escapeHtml(match.status)}">${escapeHtml(statusText(match.status))}</span></div><div class="team-versus"><div class="team"><span class="team-logo">${escapeHtml(initials(home.name))}</span><strong>${escapeHtml(home.name)}</strong><small>${home.members || 10} thành viên</small></div><span class="versus">VS</span><div class="team"><span class="team-logo">${escapeHtml(initials(away.name))}</span><strong>${escapeHtml(away.name)}</strong><small>${away.members || 10} thành viên</small></div></div><div class="match-meta"><span>▦ ${dateLabel(match.date)}</span><span>◷ ${escapeHtml((match.time || '18:00').slice(0, 5))}</span><span>⌖ ${escapeHtml(pitch?.name || match.pitch_name || 'Chưa chọn sân')}</span></div>${buttons.length ? `<div class="match-actions">${buttons.join('')}</div>` : ''}</article>`;
}

function renderFriendly() {
  const now = isoDate();
  const upcoming = data.friendlies.filter(match => match.date >= now && !['declined', 'cancelled'].includes(match.status)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const history = data.friendlies.filter(match => match.date < now || ['completed', 'declined', 'cancelled'].includes(match.status));
  return `<div class="page-shell"><div class="page-heading"><div><span class="eyebrow">Kết nối đội bóng</span><h1>Giao hữu cùng nhau</h1><p>Nhận lời mời, hẹn lịch đá và mở rộng cộng đồng sân cỏ.</p></div><div class="heading-actions">${currentUser?.role === 'admin' ? '<button class="button-outline" data-action="random-match">⚡ Ghép đội ngẫu nhiên</button>' : '<button class="button-primary" data-action="request-match">＋ Tạo lời mời</button>'}</div></div>
    ${currentUser ? `<div class="panel" style="margin-bottom:18px"><div class="section-head" style="margin:0"><div><h3 style="margin:0;font-size:14px">Đội của bạn: ${escapeHtml(userTeam()?.name || 'Chưa có đội')}</h3><p style="margin-bottom:0">${userTeam() ? 'Theo dõi lời mời và lịch đá của đội.' : 'Tạo đội trong hồ sơ để gửi lời mời giao hữu.'}</p></div></div></div>` : ''}
    <div class="section-head"><div><h2 style="font-size:19px">Lịch sắp tới</h2><p>Nhận lời hoặc đề xuất khung giờ khác nếu đội bạn bận.</p></div></div>${upcoming.length ? `<div class="match-grid">${upcoming.map(matchCard).join('')}</div>` : '<div class="panel empty-state"><div class="empty-icon">⚽</div><h3>Chưa có cuộc hẹn nào</h3><p>Tạo lời mời mới hoặc chờ admin ghép đội cho bạn.</p></div>'}
    ${history.length ? `<section class="section compact"><div class="section-head"><div><h2 style="font-size:19px">Lịch sử giao hữu</h2><p>Các trận đã diễn ra và lời mời trước đó.</p></div></div><div class="match-grid">${history.map(matchCard).join('')}</div></section>` : ''}</div>`;
}

function renderProfile() {
  if (!currentUser) return `<div class="page-shell"><div class="panel empty-state"><div class="empty-icon">👤</div><h3>Đăng nhập để xem hồ sơ đội bóng</h3><p>Lịch sử đặt sân và giao hữu sẽ được lưu tại đây.</p><button class="button-primary" data-action="auth" style="margin-top:16px">Đăng nhập / Đăng ký</button></div></div>`;
  if (currentUser.role === 'admin') return `<div class="page-shell"><div class="panel empty-state"><div class="empty-icon">🛡</div><h3>Tài khoản quản trị</h3><p>Quản lý lịch sân, ghép đội và xử lý lịch giao hữu trong bảng điều khiển.</p><button class="button-primary" data-view="admin" style="margin-top:16px">Mở bảng quản lý</button></div></div>`;
  const team = userTeam();
  const bookings = myBookings().sort((a, b) => `${b.date}${b.start_time}`.localeCompare(`${a.date}${a.start_time}`));
  const matches = myFriendlies().sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  return `<div class="page-shell"><div class="page-heading"><div><span class="eyebrow">Khu vực cá nhân</span><h1>Hồ sơ của bạn</h1><p>Lịch đặt sân và hành trình giao hữu của đội.</p></div><div class="heading-actions">${team ? '' : '<button class="button-primary" data-action="create-team">＋ Tạo đội bóng</button>'}</div></div><div class="profile-layout"><aside class="profile-card"><div class="profile-cover"></div><div class="profile-avatar-wrap"><span class="avatar profile-avatar">${escapeHtml(initials(currentUser.name))}</span></div><h2 class="profile-name">${escapeHtml(currentUser.name)}</h2><div class="profile-email">${escapeHtml(currentUser.email || 'Tài khoản Sân Nhà')}</div><span class="profile-role">${currentUser.role === 'admin' ? 'Quản trị viên' : 'Thành viên Sân Nhà'}</span>${team ? `<div class="quick-stat" style="margin-top:17px"><span class="quick-icon">🛡</span><div><strong>${escapeHtml(team.name)}</strong><small>${team.members || 10} thành viên</small></div></div>` : ''}<div class="profile-summary"><div><strong>${bookings.length}</strong><span>Lượt đặt sân</span></div><div><strong>${matches.length}</strong><span>Trận giao hữu</span></div><div><strong>${team?.members || 0}</strong><span>Thành viên</span></div></div><button class="button-outline" data-action="logout" style="width:100%;margin-top:18px">Đăng xuất</button></aside><section class="panel"><div class="section-head"><div><h2 style="font-size:18px">Lịch sử giao hữu</h2><p>Những đội đã gặp và các cuộc hẹn sắp tới.</p></div><button class="text-link" data-view="friendly">Mở giao hữu&nbsp; →</button></div>${matches.length ? matches.map(match => { const home = teamById(match.home_team_id)?.name || 'Đội nhà'; const away = teamById(match.away_team_id)?.name || 'Đội khách'; const pitch = pitchById(match.pitch_id)?.name || 'Chưa chọn sân'; return `<div class="history-item"><span class="history-icon">⚽</span><div><strong>${escapeHtml(home)} &nbsp;·&nbsp; ${escapeHtml(away)}</strong><small>${dateLabel(match.date)} · ${escapeHtml(pitch)} · ${escapeHtml((match.time || '').slice(0, 5))}</small></div><span class="history-result">${escapeHtml(statusText(match.status))}</span></div>`; }).join('') : '<div class="empty-state"><h3>Chưa có lịch sử giao hữu</h3><p>Gửi lời mời đầu tiên để kết nối với đội khác.</p></div>'}<div class="section-head" style="margin:27px 0 7px"><div><h2 style="font-size:18px">Lịch đặt sân của tôi</h2><p>Kiểm tra ngày và trạng thái các sân đã đặt.</p></div></div>${bookings.length ? bookings.map(item => `<div class="history-item"><span class="history-icon">🏟</span><div><strong>${escapeHtml(pitchById(item.pitch_id)?.name || 'Sân bóng')} · ${escapeHtml(item.team || team?.name || 'Đội của bạn')}</strong><small>${dateLabel(item.date)} · ${escapeHtml(item.start_time?.slice(0, 5))}–${escapeHtml(item.end_time?.slice(0, 5))}</small></div><span class="history-result">${escapeHtml(statusText(item.status))}</span></div>`).join('') : '<div class="empty-state"><h3>Bạn chưa đặt sân</h3><p>Chọn sân và khung giờ còn trống để bắt đầu.</p><button class="button-soft" data-view="booking" style="margin-top:12px">Tìm sân trống</button></div>'}</section></div></div>`;
}

function renderAdmin() {
  if (currentUser?.role !== 'admin') return '<div class="page-shell"><div class="panel empty-state"><h3>Vui lòng đăng nhập với quyền admin</h3><button class="button-primary" data-action="auth">Đăng nhập</button></div></div>';
  const bookingRows = data.bookings.slice().sort((a, b) => `${a.date}${a.start_time}`.localeCompare(`${b.date}${b.start_time}`));
  const matchRows = data.friendlies.slice().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return `<div class="page-shell"><div class="page-heading"><div><span class="eyebrow">Bảng điều khiển</span><h1>Quản lý sân & lịch đấu</h1><p>Quản lý trạng thái đặt sân, ghép cặp và xác nhận lịch giao hữu.</p></div><div class="heading-actions"><button class="button-outline" data-action="admin-add-booking">＋ Thêm lịch sân</button><button class="button-primary" data-action="random-match">⚡ Ghép đội ngẫu nhiên</button></div></div><div class="stats-strip" style="margin:0 0 20px"><div class="stat-card"><strong>${data.pitches.length}</strong><span>Sân đang quản lý</span></div><div class="stat-card"><strong>${data.bookings.filter(x => x.status === 'confirmed').length}</strong><span>Lịch sân đã xác nhận</span></div><div class="stat-card"><strong>${data.friendlies.filter(x => x.status === 'pending').length}</strong><span>Lời mời chờ xử lý</span></div><div class="stat-card"><strong>${data.teams.length}</strong><span>Đội bóng kết nối</span></div></div><section class="panel"><div class="admin-tabs"><button class="admin-tab ${activeAdminTab === 'bookings' ? 'active' : ''}" data-action="admin-tab" data-tab="bookings">Lịch đặt sân (${bookingRows.length})</button><button class="admin-tab ${activeAdminTab === 'matches' ? 'active' : ''}" data-action="admin-tab" data-tab="matches">Giao hữu (${matchRows.length})</button></div>${activeAdminTab === 'bookings' ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Sân</th><th>Ngày / giờ</th><th>Đội đặt</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead><tbody>${bookingRows.map(item => `<tr><td><strong>${escapeHtml(pitchById(item.pitch_id)?.name || 'Sân bóng')}</strong></td><td>${dateLabel(item.date)}<br>${escapeHtml(item.start_time?.slice(0,5))}–${escapeHtml(item.end_time?.slice(0,5))}</td><td>${escapeHtml(item.team || 'Khách')}</td><td><span class="match-status ${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</span></td><td><select class="status-select" data-action="booking-status" data-id="${escapeHtml(item.id)}"><option value="confirmed" ${item.status === 'confirmed' ? 'selected' : ''}>Đã đặt</option><option value="cancelled" ${item.status === 'cancelled' ? 'selected' : ''}>Trống / hủy</option></select></td></tr>`).join('')}</tbody></table></div>` : `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Hai đội</th><th>Ngày / giờ</th><th>Sân</th><th>Trạng thái</th><th>Xử lý</th></tr></thead><tbody>${matchRows.map(item => `<tr><td><strong>${escapeHtml(teamById(item.home_team_id)?.name || 'Đội nhà')}</strong><br>vs ${escapeHtml(teamById(item.away_team_id)?.name || 'Đội khách')}</td><td>${dateLabel(item.date)}<br>${escapeHtml(item.time?.slice(0,5))}</td><td>${escapeHtml(pitchById(item.pitch_id)?.name || 'Chưa xếp')}</td><td><span class="match-status ${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</span></td><td>${(['pending','reschedule_proposed'].includes(item.status) || ['accepted','confirmed'].includes(item.status)) ? `<button class="button-soft" data-action="admin-schedule-match" data-id="${escapeHtml(item.id)}">Xếp lịch</button>${item.status === 'accepted' && item.pitch_id ? `<button class="button-primary" data-action="admin-match-confirm" data-id="${escapeHtml(item.id)}">Xác nhận</button>` : ''}${['pending','reschedule_proposed'].includes(item.status) ? `<button class="button-danger" data-action="match-decline" data-id="${escapeHtml(item.id)}">Từ chối</button>` : `<button class="button-danger" data-action="admin-match-cancel" data-id="${escapeHtml(item.id)}">Hủy lịch</button>`}` : '—'}</td></tr>`).join('')}</tbody></table></div>`}</section></div>`;
}

function showToast(message) {
  const toast = $('#toast'); if (!toast) return;
  toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function openDialog(title, subtitle, body) {
  $('#dialogContent').innerHTML = `<div class="dialog-head"><div><h2>${title}</h2><p>${subtitle || ''}</p></div><button class="dialog-close" data-action="close-dialog" aria-label="Đóng">×</button></div><div class="dialog-body">${body}</div>`;
  const dialog = $('#appDialog'); if (!dialog.open) dialog.showModal();
}
function openAuth(mode = 'login') {
  const register = mode === 'register';
  const switcher = `<div class="auth-switch"><button class="${!register ? 'active' : ''}" data-action="auth-mode" data-mode="login">Đăng nhập</button><button class="${register ? 'active' : ''}" data-action="auth-mode" data-mode="register">Tạo tài khoản</button></div>`;
  const form = register ? `<form id="authForm" class="dialog-form"><input type="hidden" name="mode" value="register"><div class="field"><label>Họ và tên</label><input name="name" required placeholder="Nguyễn Văn An"></div><div class="field"><label>Email</label><input name="email" type="email" required placeholder="ban@email.com"></div><div class="field"><label>Mật khẩu</label><input name="password" type="password" minlength="6" required placeholder="Tối thiểu 6 ký tự"></div><div class="field"><label>Tên đội bóng (không bắt buộc)</label><input name="team" placeholder="Ví dụ: FC Sân Nhà"></div><div class="dialog-actions"><button type="button" class="button-outline" data-action="close-dialog">Để sau</button><button class="button-primary">Tạo tài khoản</button></div></form>` : `<form id="authForm" class="dialog-form"><input type="hidden" name="mode" value="login"><div class="field"><label>Email</label><input name="email" type="email" required placeholder="ban@email.com"></div><div class="field"><label>Mật khẩu</label><input name="password" type="password" required placeholder="Mật khẩu của bạn"></div><div class="dialog-actions"><button type="submit" class="button-primary" style="width:100%">Đăng nhập</button></div></form>`;
  openDialog(register ? 'Tạo tài khoản Sân Nhà' : 'Chào mừng trở lại', register ? 'Tham gia cộng đồng bóng đá quanh bạn.' : 'Đăng nhập để quản lý lịch sân và đội bóng.', `${switcher}${form}`);
}
function openBookingDialog(pitchId, time) {
  if (!currentUser) { pendingBooking = { pitchId, time }; openAuth(); showToast('Đăng nhập để tiếp tục đặt sân.'); return; }
  if (currentUser.role === 'admin') { showToast('Admin có thể tạo lịch sân trong mục Quản lý.'); return; }
  const pitch = pitchById(pitchId);
  openDialog(`Đặt ${escapeHtml(pitch?.name || 'sân bóng')}`, 'Kiểm tra thông tin trước khi xác nhận lịch.', `<form id="bookingForm" class="dialog-form"><input type="hidden" name="pitch_id" value="${escapeHtml(pitchId)}"><div class="form-row"><div class="field"><label>Ngày chơi</label><input type="date" name="date" value="${selectedDate}" min="${isoDate()}" required></div><div class="field"><label>Khung giờ</label><select name="time">${SLOT_TIMES.map(item => `<option ${item === time ? 'selected' : ''}>${item}</option>`).join('')}</select></div></div><div class="field"><label>Tên đội / người đặt</label><input name="team" value="${escapeHtml(userTeam()?.name || currentUser.name)}" required></div><div class="side-note">${escapeHtml(pitch?.size || '')} · ${money(pitch?.price)}/giờ · Trạng thái sẽ được cập nhật ngay sau khi xác nhận.</div><div class="dialog-actions"><button type="button" class="button-outline" data-action="close-dialog">Quay lại</button><button class="button-primary">Xác nhận đặt sân</button></div></form>`);
}
function openFriendlyDialog() {
  if (!currentUser) { openAuth(); showToast('Đăng nhập để gửi lời mời giao hữu.'); return; }
  if (currentUser.role === 'admin') { showToast('Admin dùng chức năng ghép đội ngẫu nhiên.'); return; }
  if (!userTeam()) { showToast('Hãy tạo đội bóng trong hồ sơ trước.'); setView('profile'); return; }
  const opponents = data.teams.filter(team => String(team.id) !== String(userTeam().id) && team.owner_id);
  if (!opponents.length) { showToast('Cần thêm một đội có tài khoản để gửi lời mời giao hữu.'); return; }
  openDialog('Tạo lời mời giao hữu', `Đội của bạn: ${escapeHtml(userTeam().name)}`, `<form id="friendlyForm" class="dialog-form"><div class="field"><label>Mời đội</label><select name="opponent_team_id" required>${opponents.map(team => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join('')}</select></div><div class="form-row"><div class="field"><label>Ngày dự kiến</label><input type="date" name="date" min="${isoDate()}" value="${addDays(isoDate(), 2)}" required></div><div class="field"><label>Giờ dự kiến</label><select name="time">${SLOT_TIMES.map(t => `<option ${t === '19:00' ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div><div class="field"><label>Sân đề xuất</label><select name="pitch_id"><option value="">Để admin sắp xếp</option>${data.pitches.map(pitch => `<option value="${escapeHtml(pitch.id)}">${escapeHtml(pitch.name)} · ${escapeHtml(pitch.size)}</option>`).join('')}</select></div><div class="dialog-actions"><button type="button" class="button-outline" data-action="close-dialog">Hủy</button><button class="button-primary">Gửi lời mời</button></div></form>`);
}
function openReschedule(matchId) {
  const match = data.friendlies.find(item => String(item.id) === String(matchId));
  if (!match) return;
  openDialog('Đề xuất lịch khác', 'Đội bạn bận? Gửi một khung giờ mới để hai bên thống nhất.', `<form id="rescheduleForm" class="dialog-form"><input type="hidden" name="id" value="${escapeHtml(matchId)}"><div class="form-row"><div class="field"><label>Ngày mới</label><input type="date" name="date" min="${isoDate()}" value="${match.date >= isoDate() ? match.date : addDays(isoDate(), 2)}" required></div><div class="field"><label>Giờ mới</label><select name="time">${SLOT_TIMES.map(t => `<option ${t === (match.time || '19:00').slice(0,5) ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div><div class="dialog-actions"><button type="button" class="button-outline" data-action="close-dialog">Quay lại</button><button class="button-primary">Gửi đề xuất</button></div></form>`);
}
function openRandomMatchDialog() {
  if (currentUser?.role !== 'admin') return;
  openDialog('Ghép đội ngẫu nhiên', 'Admin chọn sân và thời gian, hệ thống sẽ chọn ngẫu nhiên hai đội.', `<form id="randomForm" class="dialog-form"><div class="form-row"><div class="field"><label>Ngày thi đấu</label><input type="date" name="date" min="${isoDate()}" value="${addDays(isoDate(), 2)}" required></div><div class="field"><label>Khung giờ</label><select name="time">${SLOT_TIMES.map(t => `<option ${t === '19:00' ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div><div class="field"><label>Sân tổ chức</label><select name="pitch_id" required>${data.pitches.map(pitch => `<option value="${escapeHtml(pitch.id)}">${escapeHtml(pitch.name)} · ${escapeHtml(pitch.size)}</option>`).join('')}</select></div><div class="dialog-actions"><button type="button" class="button-outline" data-action="close-dialog">Hủy</button><button class="button-primary">🎲 Ghép đội</button></div></form>`);
}
function openAdminBookingDialog() {
  if (currentUser?.role !== 'admin') return;
  openDialog('Thêm lịch sân', 'Admin giữ sân cho đội hoặc khách đặt.', `<form id="adminBookingForm" class="dialog-form"><div class="field"><label>Sân</label><select name="pitch_id">${data.pitches.map(pitch => `<option value="${escapeHtml(pitch.id)}">${escapeHtml(pitch.name)}</option>`).join('')}</select></div><div class="form-row"><div class="field"><label>Ngày</label><input type="date" name="date" min="${isoDate()}" value="${selectedDate}" required></div><div class="field"><label>Khung giờ</label><select name="time">${SLOT_TIMES.map(t => `<option>${t}</option>`).join('')}</select></div></div><div class="field"><label>Tên đội / người đặt</label><input name="team" required placeholder="Tên đội bóng"></div><div class="dialog-actions"><button type="button" class="button-outline" data-action="close-dialog">Hủy</button><button class="button-primary">Tạo lịch sân</button></div></form>`);
}
function openScheduleFriendlyDialog(matchId) {
  if (currentUser?.role !== 'admin') return;
  const match = data.friendlies.find(item => String(item.id) === String(matchId));
  if (!match) return;
  openDialog('Xếp sân và giờ giao hữu', 'Hai đội sẽ thấy lịch cập nhật để phản hồi.', `<form id="scheduleFriendlyForm" class="dialog-form"><input type="hidden" name="id" value="${escapeHtml(matchId)}"><div class="form-row"><div class="field"><label>Ngày</label><input type="date" name="date" min="${isoDate()}" value="${match.date >= isoDate() ? match.date : addDays(isoDate(), 2)}" required></div><div class="field"><label>Khung giờ</label><select name="time">${SLOT_TIMES.map(t => `<option ${t === (match.time || '19:00').slice(0,5) ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div><div class="field"><label>Sân thi đấu</label><select name="pitch_id" required>${data.pitches.map(pitch => `<option value="${escapeHtml(pitch.id)}" ${String(pitch.id) === String(match.pitch_id) ? 'selected' : ''}>${escapeHtml(pitch.name)} · ${escapeHtml(pitch.size)}</option>`).join('')}</select></div><div class="dialog-actions"><button type="button" class="button-outline" data-action="close-dialog">Hủy</button><button class="button-primary">Lưu lịch giao hữu</button></div></form>`);
}

async function handleAuth(form) {
  const fields = Object.fromEntries(new FormData(form).entries());
  const mode = fields.mode;
  try {
    await requestApi(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(fields) });
    await refreshFromApi();
    $('#appDialog').close(); updateHeader(); render(); showToast(`Xin chào ${currentUser.name}!`);
    if (pendingBooking) { const item = pendingBooking; pendingBooking = null; openBookingDialog(item.pitchId, item.time); }
  } catch (error) { showToast(error.message || 'Không thể đăng nhập.'); }
}

async function saveBooking(form, admin = false) {
  const fields = Object.fromEntries(new FormData(form).entries());
  try {
    const endpoint = admin ? '/api/admin/bookings' : '/api/bookings';
    await requestApi(endpoint, { method: 'POST', body: JSON.stringify(fields) });
    await refreshFromApi();
    $('#appDialog').close(); selectedDate = fields.date; render(); showToast('Đã cập nhật lịch sân.');
  } catch (error) { showToast(error.message || 'Không thể lưu lịch sân.'); }
}

async function saveFriendly(form) {
  const fields = Object.fromEntries(new FormData(form).entries());
  try {
    await requestApi('/api/friendlies', { method: 'POST', body: JSON.stringify(fields) });
    await refreshFromApi();
    $('#appDialog').close(); setView('friendly'); showToast('Đã gửi lời mời giao hữu.');
  } catch (error) { showToast(error.message || 'Không thể gửi lời mời.'); }
}

async function matchAction(id, action, extra = {}) {
  try {
    await requestApi(`/api/friendlies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action, ...extra }) });
    await refreshFromApi();
    $('#appDialog').open && $('#appDialog').close(); render(); showToast(action === 'decline' ? 'Đã từ chối lời mời.' : action === 'cancel' ? 'Đã hủy lịch giao hữu.' : action === 'reschedule' ? 'Đã gửi đề xuất lịch mới.' : 'Đã cập nhật lịch giao hữu.');
  } catch (error) { showToast(error.message || 'Không thể cập nhật lịch.'); }
}

async function randomMatch(form) {
  const fields = Object.fromEntries(new FormData(form).entries());
  try {
    await requestApi('/api/admin/friendlies/random', { method: 'POST', body: JSON.stringify(fields) });
    await refreshFromApi();
    $('#appDialog').close(); activeAdminTab = 'matches'; setView('admin'); showToast('Đã ghép ngẫu nhiên hai đội.');
  } catch (error) { showToast(error.message || 'Không thể ghép đội.'); }
}

async function updateBookingStatus(id, status) {
  try {
    await requestApi(`/api/admin/bookings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await refreshFromApi();
    render(); showToast(status === 'cancelled' ? 'Lịch sân đã chuyển về trống.' : 'Lịch sân đã được xác nhận.');
  } catch (error) { showToast(error.message || 'Không thể cập nhật trạng thái.'); }
}
async function scheduleFriendly(form) {
  const fields = Object.fromEntries(new FormData(form).entries());
  try {
    await requestApi(`/api/admin/friendlies/${encodeURIComponent(fields.id)}/schedule`, { method: 'PATCH', body: JSON.stringify(fields) });
    await refreshFromApi();
    $('#appDialog').close(); activeAdminTab = 'matches'; render(); showToast('Đã cập nhật sân và giờ giao hữu.');
  } catch (error) { showToast(error.message || 'Không thể xếp lịch giao hữu.'); }
}

document.addEventListener('click', async event => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { event.preventDefault(); const view = viewButton.dataset.view; if (view === 'home' || view === 'booking' || view === 'friendly' || view === 'profile' || view === 'admin') setView(view); return; }
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, id, pitch, time } = control.dataset;
  if (action === 'auth') openAuth();
  else if (action === 'retry-connect') {
    try { await refreshFromApi(); render(); showToast('Đã kết nối hệ thống.'); }
    catch (error) { apiLive = false; apiError = error.message || 'Không kết nối được máy chủ.'; render(); }
  }
  else if (action === 'auth-mode') openAuth(control.dataset.mode);
  else if (action === 'close-dialog') $('#appDialog').close();
  else if (action === 'logout') {
    try {
      await requestApi('/api/auth/logout', { method: 'POST', body: '{}' });
      await refreshFromApi();
      setView('home');
      showToast('Đã đăng xuất.');
    } catch (error) { showToast(error.message || 'Không thể đăng xuất.'); }
  } else if (action === 'mobile-menu') $('.main-nav')?.classList.toggle('open');
  else if (action === 'go-booking') setView('booking');
  else if (action === 'book-slot') openBookingDialog(pitch, time);
  else if (action === 'request-match') openFriendlyDialog();
  else if (action === 'match-accept') await matchAction(id, 'accept');
  else if (action === 'match-decline') await matchAction(id, 'decline');
  else if (action === 'match-reschedule') openReschedule(id);
  else if (action === 'admin-match-confirm') await matchAction(id, 'confirm');
  else if (action === 'admin-match-cancel') await matchAction(id, 'cancel');
  else if (action === 'admin-schedule-match') openScheduleFriendlyDialog(id);
  else if (action === 'random-match') openRandomMatchDialog();
  else if (action === 'admin-add-booking') openAdminBookingDialog();
  else if (action === 'apply-filter') { selectedDate = $('#bookingDate')?.value || selectedDate; selectedArea = $('#areaFilter')?.value || 'all'; selectedSize = $('#sizeFilter')?.value || 'all'; render(); }
  else if (action === 'admin-tab') { activeAdminTab = control.dataset.tab; render(); }
  else if (action === 'create-team') {
    if (currentUser?.role !== 'user') { showToast('Chỉ tài khoản user mới tạo đội.'); return; }
    openDialog('Tạo đội bóng', 'Đội của bạn sẽ xuất hiện trong danh sách tìm đối giao hữu.', `<form id="teamForm" class="dialog-form"><div class="field"><label>Tên đội bóng</label><input name="name" required placeholder="FC Sân Nhà"></div><div class="dialog-actions"><button type="button" class="button-outline" data-action="close-dialog">Hủy</button><button class="button-primary">Tạo đội</button></div></form>`);
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'heroSearch') {
    selectedDate = form.elements.date.value || isoDate();
    selectedSize = form.elements.size.value;
    selectedArea = form.elements.area.value;
    setView('booking');
  } else if (form.id === 'authForm') await handleAuth(form);
  else if (form.id === 'bookingForm') await saveBooking(form, false);
  else if (form.id === 'adminBookingForm') await saveBooking(form, true);
  else if (form.id === 'friendlyForm') await saveFriendly(form);
  else if (form.id === 'randomForm') await randomMatch(form);
  else if (form.id === 'scheduleFriendlyForm') await scheduleFriendly(form);
  else if (form.id === 'rescheduleForm') { const fields = Object.fromEntries(new FormData(form).entries()); await matchAction(fields.id, 'reschedule', { date: fields.date, time: fields.time }); }
  else if (form.id === 'teamForm') {
    const fields = Object.fromEntries(new FormData(form).entries());
    try { await requestApi('/api/teams', { method: 'POST', body: JSON.stringify(fields) }); await refreshFromApi(); $('#appDialog').close(); setView('profile'); showToast('Đã tạo đội bóng.'); }
    catch (error) { showToast(error.message); }
  }
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'bookingDate') { selectedDate = target.value || isoDate(); render(); }
  else if (target.id === 'areaFilter') { selectedArea = target.value; render(); }
  else if (target.id === 'sizeFilter') { selectedSize = target.value; render(); }
  else if (target.matches('[data-action="booking-status"]')) updateBookingStatus(target.dataset.id, target.value);
});

$('#appDialog')?.addEventListener('click', event => { if (event.target === $('#appDialog')) $('#appDialog').close(); });

init();
