// 개발 중 사이트를 통째로 막아두기 위한 스위치. Vercel 환경변수
// MAINTENANCE_MODE 를 "true"로 켜두면 페이지/API 할 것 없이 전부 점검 화면을
// 보여준다 - 꺼두면(값 삭제 또는 false) 평소처럼 그대로 동작한다.
//
// 본인은 계속 개발하면서 확인해야 하니, MAINTENANCE_BYPASS_KEY를 같이
// 설정해두면 주소 끝에 ?bypass=그값 을 붙였을 때만 본인은 그대로 통과된다.
// 그 쿼리는 쿠키로 남겨서, 한 번 통과한 뒤엔 다른 페이지 이동해도 계속 풀려있다.

export const config = {
  matcher: '/((?!_vercel|favicon.ico).*)',
};

const BYPASS_COOKIE = 'maint_bypass';

function maintenanceHtml() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>점검 중 - BUY NOW OR LIVE</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#f9f7f3; color:#202020; font-family:'Pretendard',-apple-system,sans-serif; text-align:center; padding:24px; }
  .box { max-width: 420px; }
  h1 { font-size: 22px; margin-bottom: 12px; }
  p { font-size: 15px; color: #646464; line-height:1.6; }
</style>
</head>
<body>
  <div class="box">
    <h1>🔧 잠시 점검 중이에요</h1>
    <p>더 나은 모습으로 곧 다시 찾아뵐게요.<br />조금만 기다려주세요!</p>
  </div>
</body>
</html>`;
}

export default function middleware(request) {
  if (process.env.MAINTENANCE_MODE !== 'true') return;

  const url = new URL(request.url);
  const bypassKey = process.env.MAINTENANCE_BYPASS_KEY;
  const cookieOk = bypassKey && request.headers.get('cookie')?.includes(`${BYPASS_COOKIE}=${bypassKey}`);
  const queryOk = bypassKey && url.searchParams.get('bypass') === bypassKey;

  if (queryOk) {
    // 통과 확인되면 쿠키로 남겨서 이후 요청엔 ?bypass= 를 매번 안 붙여도 되게 한다.
    // 리다이렉트 주소에서는 bypass 쿼리만 빼고 나머지 쿼리는 그대로 유지한다
    const cleanUrl = new URL(url);
    cleanUrl.searchParams.delete('bypass');
    const res = new Response(null, { status: 302, headers: { Location: cleanUrl.pathname + cleanUrl.search } });
    res.headers.append('Set-Cookie', `${BYPASS_COOKIE}=${bypassKey}; Path=/; Max-Age=86400; SameSite=Lax`);
    return res;
  }
  if (cookieOk) return;

  return new Response(maintenanceHtml(), {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '3600' },
  });
}
