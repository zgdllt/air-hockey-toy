-- Server-only game accounts. No Bilibili IDs or platform credentials are stored.
CREATE TABLE public.ah_players (
  scope text NOT NULL,
  id uuid NOT NULL,
  token_hash text NOT NULL,
  alias text NOT NULL,
  elo integer NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, id),
  UNIQUE (scope, token_hash)
);
CREATE TABLE public.ah_stats (
  scope text NOT NULL,
  player_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('solo','ranked')),
  difficulty text NOT NULL CHECK (difficulty IN ('warmup','standard','challenge')),
  window_key text NOT NULL,
  games integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  best_streak integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, player_id, mode, difficulty, window_key),
  FOREIGN KEY (scope, player_id) REFERENCES public.ah_players(scope,id),
  CHECK (games >= wins AND wins >= 0 AND streak >= 0 AND best_streak >= streak)
);
CREATE INDEX ah_stats_board ON public.ah_stats(scope,mode,difficulty,window_key);
CREATE TABLE public.ah_matches (
  scope text NOT NULL,
  id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('solo','ranked')),
  difficulty text NOT NULL,
  player_a uuid NOT NULL,
  player_b uuid,
  status text NOT NULL CHECK (status IN ('running','finished','void')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (scope,id),
  FOREIGN KEY (scope,player_a) REFERENCES public.ah_players(scope,id),
  FOREIGN KEY (scope,player_b) REFERENCES public.ah_players(scope,id)
);
CREATE INDEX ah_matches_pending ON public.ah_matches(scope,status) WHERE status='running';

CREATE FUNCTION public.ah_profile(p_scope text,p_player uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'alias',p.alias,'elo',p.elo,'stats',
    coalesce((SELECT jsonb_agg(to_jsonb(s)-'scope'-'player_id'-'window_key')
      FROM public.ah_stats s WHERE s.scope=p_scope AND s.player_id=p.id AND s.window_key='all'),'[]'::jsonb))
  FROM public.ah_players p WHERE p.scope=p_scope AND p.id=p_player
$$;

CREATE FUNCTION public.ah_bump(p_scope text,p_player uuid,p_mode text,p_difficulty text,p_won boolean)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE k text; local_time timestamp := now() AT TIME ZONE 'Asia/Shanghai';
BEGIN
  FOREACH k IN ARRAY ARRAY['all','day:'||to_char(local_time,'YYYY-MM-DD'),
    'week:'||to_char(date_trunc('week',local_time),'YYYY-MM-DD'),'month:'||to_char(local_time,'YYYY-MM')]
  LOOP
    INSERT INTO public.ah_stats AS s(scope,player_id,mode,difficulty,window_key,games,wins,streak,best_streak)
    VALUES(p_scope,p_player,p_mode,p_difficulty,k,1,p_won::int,p_won::int,p_won::int)
    ON CONFLICT(scope,player_id,mode,difficulty,window_key) DO UPDATE SET
      games=s.games+1,wins=s.wins+p_won::int,
      streak=CASE WHEN p_won THEN s.streak+1 ELSE 0 END,
      best_streak=greatest(s.best_streak,CASE WHEN p_won THEN s.streak+1 ELSE 0 END),
      updated_at=now();
  END LOOP;
END $$;

-- Every call is a single transaction. Browser roles cannot invoke this RPC.
CREATE FUNCTION public.ah_operation(p_scope text,p_action text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
<<op>>
DECLARE
  player_id uuid; a uuid; b uuid; match_id uuid; inserted uuid;
  match_row public.ah_matches%ROWTYPE; ra integer; rb integer; delta integer;
  winner uuid; won boolean; diff text; response jsonb; count_void integer;
  metric text; mode_name text; period_name text; window_name text;
  local_time timestamp := now() AT TIME ZONE 'Asia/Shanghai';
BEGIN
  IF p_scope IS NULL OR length(p_scope)>64 THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  IF p_action='register' THEN
    player_id := (p_payload->>'id')::uuid;
    INSERT INTO public.ah_players(scope,id,token_hash,alias)
      VALUES(p_scope,player_id,p_payload->>'token_hash',p_payload->>'alias');
    RETURN public.ah_profile(p_scope,player_id);
  ELSIF p_action='auth' THEN
    SELECT id INTO player_id FROM public.ah_players
      WHERE scope=p_scope AND token_hash=p_payload->>'token_hash';
    IF player_id IS NULL THEN RAISE EXCEPTION 'invalid_account'; END IF;
    RETURN public.ah_profile(p_scope,player_id);
  ELSIF p_action='recover' THEN
    UPDATE public.ah_matches SET status='void',finished_at=now(),
      result=jsonb_build_object('reason','server_restart')
      WHERE scope=p_scope AND status='running';
    GET DIAGNOSTICS count_void=ROW_COUNT;
    RETURN jsonb_build_object('voided',count_void);
  ELSIF p_action='board' THEN
    metric := p_payload->>'metric'; mode_name := p_payload->>'mode';
    diff := CASE WHEN mode_name='ranked' THEN 'standard' ELSE p_payload->>'difficulty' END;
    period_name := CASE WHEN metric='elo' THEN 'all' ELSE p_payload->>'period' END;
    window_name := CASE period_name
      WHEN 'all' THEN 'all'
      WHEN 'day' THEN 'day:'||to_char(local_time,'YYYY-MM-DD')
      WHEN 'week' THEN 'week:'||to_char(date_trunc('week',local_time),'YYYY-MM-DD')
      WHEN 'month' THEN 'month:'||to_char(local_time,'YYYY-MM') ELSE NULL END;
    IF metric NOT IN ('elo','streak','rate','wins') OR mode_name NOT IN ('solo','ranked')
      OR window_name IS NULL OR (metric='elo' AND mode_name<>'ranked')
      OR diff NOT IN ('warmup','standard','challenge') THEN RAISE EXCEPTION 'invalid_board'; END IF;
    player_id := nullif(p_payload->>'player_id','')::uuid;
    WITH base AS (
      SELECT s.player_id,p.alias,p.elo,s.games,s.wins,s.streak,s.best_streak,s.updated_at,
        round(100.0*s.wins/nullif(s.games,0),1) AS win_rate,
        CASE metric WHEN 'elo' THEN p.elo WHEN 'streak' THEN s.best_streak
          WHEN 'wins' THEN s.wins ELSE 100.0*s.wins/nullif(s.games,0) END AS score
      FROM public.ah_stats s JOIN public.ah_players p ON p.scope=s.scope AND p.id=s.player_id
      WHERE s.scope=p_scope AND s.mode=mode_name AND s.difficulty=diff AND s.window_key=window_name AND s.games>0
    ), ranked AS (
      SELECT bs.*,row_number() OVER(ORDER BY bs.score DESC,bs.wins DESC,bs.updated_at ASC,bs.player_id) AS rank
      FROM base bs WHERE metric<>'rate' OR bs.games>=10
    )
    SELECT jsonb_build_object(
      'list',coalesce((SELECT jsonb_agg(to_jsonb(t)-'updated_at') FROM (SELECT * FROM ranked WHERE rank<=30 ORDER BY rank) t),'[]'::jsonb),
      'mine',CASE WHEN player_id IS NULL THEN NULL ELSE
        coalesce((SELECT to_jsonb(r)||jsonb_build_object('ranked',true) FROM ranked r WHERE r.player_id=op.player_id),
          (SELECT to_jsonb(s)||jsonb_build_object('ranked',false,'rank',0) FROM base s WHERE s.player_id=op.player_id),
          jsonb_build_object('ranked',false,'rank',0,'games',0,'wins',0,'streak',0,'best_streak',0,'win_rate',0))
        END,'minimumGames',CASE WHEN metric='rate' THEN 10 ELSE 1 END)
      INTO response;
    RETURN response;
  ELSIF p_action='solo' THEN
    player_id := (p_payload->>'player_id')::uuid; match_id := (p_payload->>'match_id')::uuid;
    diff := p_payload->>'difficulty'; won := (p_payload->>'won')::boolean;
    IF diff NOT IN ('warmup','standard','challenge') OR won IS NULL THEN RAISE EXCEPTION 'invalid_result'; END IF;
    INSERT INTO public.ah_matches(scope,id,mode,difficulty,player_a,status,result,finished_at)
      VALUES(p_scope,match_id,'solo',diff,player_id,'finished',p_payload,now())
      ON CONFLICT(scope,id) DO NOTHING RETURNING id INTO inserted;
    IF inserted IS NOT NULL THEN
      PERFORM public.ah_bump(p_scope,player_id,'solo',diff,won);
    ELSIF NOT EXISTS(SELECT 1 FROM public.ah_matches WHERE scope=p_scope AND id=match_id
      AND player_a=player_id AND mode='solo') THEN RAISE EXCEPTION 'result_conflict'; END IF;
    RETURN public.ah_profile(p_scope,player_id);
  ELSIF p_action='start' THEN
    a := (p_payload->>'a')::uuid; b := (p_payload->>'b')::uuid; match_id := (p_payload->>'match_id')::uuid;
    IF a=b THEN RAISE EXCEPTION 'same_player'; END IF;
    PERFORM 1 FROM public.ah_players WHERE scope=p_scope AND id IN(a,b) ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.ah_matches WHERE scope=p_scope AND status='running'
      AND (player_a IN(a,b) OR player_b IN(a,b))) THEN RAISE EXCEPTION 'already_in_match'; END IF;
    INSERT INTO public.ah_matches(scope,id,mode,difficulty,player_a,player_b,status)
      VALUES(p_scope,match_id,'ranked','standard',a,b,'running');
    RETURN jsonb_build_object('match_id',match_id);
  ELSIF p_action='void' THEN
    UPDATE public.ah_matches SET status='void',finished_at=now(),result=jsonb_build_object('reason','not_started')
      WHERE scope=p_scope AND id=(p_payload->>'match_id')::uuid AND status='running';
    RETURN '{}'::jsonb;
  ELSIF p_action='finish' THEN
    match_id := (p_payload->>'match_id')::uuid; winner := (p_payload->>'winner')::uuid;
    SELECT * INTO match_row FROM public.ah_matches WHERE scope=p_scope AND id=match_id FOR UPDATE;
    IF NOT FOUND OR match_row.mode<>'ranked' THEN RAISE EXCEPTION 'invalid_match'; END IF;
    IF match_row.status='finished' THEN RETURN match_row.result; END IF;
    IF match_row.status<>'running' OR winner NOT IN(match_row.player_a,match_row.player_b) THEN RAISE EXCEPTION 'invalid_match'; END IF;
    a := match_row.player_a; b := match_row.player_b;
    PERFORM 1 FROM public.ah_players WHERE scope=p_scope AND id IN(a,b) ORDER BY id FOR UPDATE;
    SELECT elo INTO ra FROM public.ah_players WHERE scope=p_scope AND id=a;
    SELECT elo INTO rb FROM public.ah_players WHERE scope=p_scope AND id=b;
    IF winner=a THEN delta:=round(32*(1-1/(1+power(10::numeric,(rb-ra)::numeric/400))))::integer;
    ELSE delta:=-round(32*(1-1/(1+power(10::numeric,(ra-rb)::numeric/400))))::integer; END IF;
    UPDATE public.ah_players SET elo=CASE WHEN id=a THEN ra+delta ELSE rb-delta END
      WHERE scope=p_scope AND id IN(a,b);
    PERFORM public.ah_bump(p_scope,a,'ranked','standard',winner=a);
    PERFORM public.ah_bump(p_scope,b,'ranked','standard',winner=b);
    response := jsonb_build_object('match_id',match_id,'winner',winner,'reason',p_payload->>'reason',
      'players',jsonb_build_array(jsonb_build_object('profile',public.ah_profile(p_scope,a),'delta',delta),
        jsonb_build_object('profile',public.ah_profile(p_scope,b),'delta',-delta)));
    UPDATE public.ah_matches SET status='finished',result=response,finished_at=now()
      WHERE scope=p_scope AND id=match_id;
    RETURN response;
  END IF;
  RAISE EXCEPTION 'unknown_operation';
END $$;

ALTER TABLE public.ah_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ah_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ah_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ah_players,public.ah_stats,public.ah_matches FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.ah_players,public.ah_stats,public.ah_matches TO service_role;
REVOKE ALL ON FUNCTION public.ah_profile(text,uuid),public.ah_bump(text,uuid,text,text,boolean),
  public.ah_operation(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ah_profile(text,uuid),public.ah_bump(text,uuid,text,text,boolean),
  public.ah_operation(text,text,jsonb) TO service_role;
