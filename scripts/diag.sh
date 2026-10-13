#!/usr/bin/env sh
# Diagnostics of the niche-finder <-> YouTube Data API link.
# Run:  sh ~/Desktop/projects/youtube/analytic/scripts/diag.sh
# The result is written to scripts/diag-output.txt (the API key is masked).
DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="$DIR/scripts/diag-output.txt"
KEY=$(grep -E '^YOUTUBE_API_KEY' "$DIR/.env" | sed -E 's/^[^=]+=//; s/"//g' | tr -d '\r ')
{
  echo "=== 1. date ==="; date
  echo; echo "=== 2. docker ps ==="
  docker ps --format '{{.Names}}  {{.Status}}' 2>&1
  echo; echo "=== 3. key (masked) ==="
  echo "len=${#KEY} prefix=$(echo "$KEY" | cut -c1-8)"
  echo; echo "=== 4. videoCategories.list from the HOST (macOS) ==="
  curl -sS -m 20 -w "\nhttp=%{http_code} time=%{time_total}\n" \
    "https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&key=$KEY" \
    2>&1 | sed "s/$KEY/***KEY***/g" | head -c 1200
  echo; echo "=== 5. search.list from the HOST (spends 1 of 100/day) ==="
  curl -sS -m 20 -w "\nhttp=%{http_code} time=%{time_total}\n" \
    "https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&type=video&maxResults=1&key=$KEY" \
    2>&1 | sed "s/$KEY/***KEY***/g" | head -c 1200
  echo; echo "=== 6. the same call from INSIDE the niche-finder container ==="
  # -e NICHE_DATABASE_URL= blanks the host DSN from .env (localhost:5433):
  # inside the container the database is reachable only as postgres:5432.
  docker run --rm --network niche-finder_default --env-file "$DIR/.env" \
    -e NICHE_DATABASE_URL= \
    -v "$DIR/backend:/app:ro" -v niche-finder-models:/models niche-finder:latest \
    python -c "
import os,time,requests
k=os.environ.get('YOUTUBE_API_KEY','')
print('key len in container:',len(k))
t=time.time()
try:
    r=requests.get('https://www.googleapis.com/youtube/v3/videoCategories',
                   params={'part':'snippet','regionCode':'US','key':k},timeout=25)
    print('status',r.status_code,'in %.1fs'%(time.time()-t))
    print(r.text[:600].replace(k,'***KEY***') if k else r.text[:600])
except Exception as e:
    print('EXC after %.1fs:'%(time.time()-t), type(e).__name__, str(e)[:400])
" 2>&1 | sed "s/$KEY/***KEY***/g" | head -c 1500
  echo; echo "=== 7. cli.py doctor ==="
  docker run --rm --network niche-finder_default --env-file "$DIR/.env" \
    -e NICHE_DATABASE_URL= \
    -e POSTGRES_HOST=postgres -v "$DIR/backend:/app:ro" -v niche-finder-models:/models \
    niche-finder:latest python cli.py doctor 2>&1 | sed "s/$KEY/***KEY***/g" | head -c 1500
  echo; echo "=== 8. latest worker logs ==="
  docker logs --tail 40 niche-finder-worker 2>&1 | sed "s/$KEY/***KEY***/g" | head -c 2000
  echo; echo "=== END ==="
} > "$OUT" 2>&1
echo "Done. Result: $OUT"
