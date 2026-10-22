# SpeakUp AI — English Speaking Coach

## Цель проекта

MVP веб-приложения для разговорной практики английского с ИИ. Пользователь выбирает уровень
(Beginner / Intermediate / Advanced) и тему (Daily Life, Travel, Job Interview, Restaurant,
Free Conversation), нажимает **Start Speaking**, и ИИ начинает диалог на английском. Пользователь отвечает
текстом или голосом. После каждой реплики пользователя ИИ отвечает и даёт 1–3 полезных исправления
(Original phrase / Corrected phrase / Explanation на русском) или сообщает, что ошибок нет.

Обязательные функции главного экрана: выбор уровня и темы, Start Speaking, лента диалога, поле ввода,
кнопки отправки и микрофона, управление озвучиванием, панель исправлений, счётчики реплик и новых слов,
кнопка новой сессии. Состояния: загрузка, ошибка (с повтором), пустой диалог, нет поддержки микрофона.

Вне рамок MVP: авторизация, платежи, база данных, Prisma, любые другие подсистемы.

### Phase 2 (реализовано)

Ролевые сценарии с целью (`lib/constants.ts` → `SCENARIOS`), новые слова над каждым ответом ИИ, перевод по нажатию,
подсказки «💡 Не знаю, что сказать», итоги сессии с оценкой цели, практика «Повтори за мной», режим «Только голос»,
Cartesia TTS с запасным голосом браузера, скорость 0.7×–1.3× и кнопка 🐢 (0.7× без изменения общей настройки),
прогресс в localStorage (словарь, серия дней, повторение, статистика), экспорт CSV/Anki.

## Стек

- Next.js App Router, React, TypeScript (`strict: true`)
- CSS Modules (+ один `app/globals.css` только для токенов, reset и базовых стилей `body`)
- OmniRoute (локальный AI-шлюз) через OpenAI-совместимый Chat Completions API — только на сервере
- Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`, `speechSynthesis`) — только в браузере
- Cartesia TTS (опционально) — только на сервере через `/api/tts`
- Без дополнительных runtime-зависимостей сверх `next`, `react`, `react-dom`, `server-only`

## Архитектура и файлы

```
app/
  layout.tsx, page.tsx, globals.css
  api/chat/route.ts         # реплика ИИ (POST)
  api/hints/route.ts        # подсказки, если их нет в ответе (POST)
  api/translate/route.ts    # перевод по нажатию (POST)
  api/summary/route.ts      # итоги сессии (POST)
  api/tts/route.ts          # GET: провайдер озвучивания; POST: аудио Cartesia
  api/image/route.ts        # GET: статус; POST: генерация изображения
  api/image/describe/route.ts # POST: однократное описание картинки vision-моделью
components/                  # UI-компоненты, у каждого свой *.module.css
hooks/                       # useChatSession, useSpeech (Cartesia/браузер), useSpeechRecognition,
                             # useVoiceMode, useProgress (localStorage-стор)
lib/
  types.ts                   # общие типы клиента и сервера
  constants.ts               # уровни, темы, лимиты
  validation.ts              # валидация входящего запроса и ответа модели (без any)
  prompt.ts                  # построение системного промпта
  omniroute.ts               # server-only: вызов OmniRoute, тайм-ауты, маппинг ошибок
  api.ts                     # клиентские вызовы наших маршрутов
  http.ts                    # общие хелперы маршрутов: чтение тела, ошибки
  cartesia.ts                # server-only: Cartesia TTS
  progress.ts                # чистая логика прогресса: серия дней, словарь, повторение, парсинг хранилища
  export.ts                  # CSV и Anki
  phraseMatch.ts             # сравнение текста распознавания с целевой фразой (не фонетика)
  tokenize.ts                # разбиение ответа ИИ на нажимаемые слова
  vocabulary.ts              # объединение «новых слов» без дублей
types/speech-recognition.d.ts  # типы Web Speech Recognition (нет в lib.dom)
tests/                       # node:test, запускаются напрямую из .ts (Node ≥ 22.6)
```

- Модули в `lib/`, которые покрыты тестами, импортируют друг друга с расширением `.ts`
  (`allowImportingTsExtensions`), чтобы Node мог запускать тесты без сборки.
- Next.js 16 отличается от старых версий: перед использованием API сверяйся с `node_modules/next/dist/docs/` (см. `AGENTS.md`).

- Код, читающий `process.env.OMNIROUTE_*` / `CARTESIA_*`, живёт только в `lib/omniroute.ts` / `lib/cartesia.ts` и импортирует `server-only`.
- Компоненты — с одной понятной ответственностью; бизнес-логика — в хуках и `lib/`.
- Не создавать лишних слоёв абстракции.

## Контракт OmniRoute (проверен для omniroute@3.8.51)

- Endpoint: `POST {OMNIROUTE_BASE_URL}/chat/completions`, где `OMNIROUTE_BASE_URL` уже включает `/v1`
  (например `http://localhost:20128/v1`).
- Авторизация: `Authorization: Bearer <OMNIROUTE_API_KEY>` (ключ берётся в Dashboard → Endpoints).
  Если ключ пуст, заголовок не отправляется (локальный OmniRoute может разрешать запросы без ключа).
- Тело: формат OpenAI Chat Completions (`model`, `messages`, `stream: false`, `temperature`,
  `response_format: { type: "json_schema", json_schema: { name, strict, schema } }`).
- Ответ: `choices[0].message.content` — строка JSON по схеме. Её разбор — `JSON.parse` и строгая проверка
  схемы на сервере. Никакого «выкусывания» JSON регулярками из произвольного текста.
- Модель `auto` — встроенный комбо-маршрут OmniRoute. Другие модели — `GET {base}/models` с ключом.

## Контракт Cartesia (проверен по docs.cartesia.ai, октябрь 2026)

- `POST {CARTESIA_BASE_URL|https://api.cartesia.ai}/tts/bytes`, заголовки `Authorization: Bearer <key>`,
  `Cartesia-Version: 2026-08-14` (единственное допустимое значение), `Content-Type: application/json`.
- Тело: `{ model_id, transcript, voice: { id }, output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 }, language: "en" }`.
- Ответ 200 — бинарное аудио. Голос по умолчанию — `GET /voices?language=en` → `data[0].id`.
- Скорость меняется на клиенте через `playbackRate` (аудио кэшируется и переиспользуется для 🐢).

Любое изменение контракта сначала проверяется по документации/исходникам установленной версии.
Не придумывать endpoint, параметры, модели или формат ответа.

## TypeScript / React / Next.js

- `strict`, без `any`; неизвестные данные — `unknown` + сужение типов.
- Серверная логика — только в Route Handlers; клиентские компоненты помечаются `"use client"`.
- Хуки очищают ресурсы в `useEffect` cleanup (recognition.abort, speechSynthesis.cancel, AbortController).
- Асинхронные запросы отменяются при сбросе сессии; защита от двойной отправки через ref-флаг.
- Не хранить секреты и чувствительные данные в `localStorage`. Там лежит только учебный прогресс
  (`speakup.progress.v1`); чтение защищено `parseProgress`, запись — try/catch, на сервере снапшот `null`.
- Режим «Только голос»: микрофон включается только после окончания озвучивания и не перезапускается после пустой
  попытки — никаких циклов.

## CSS Modules

- Стили компонентов — в `Component.module.css` рядом с компонентом.
- Цвета, радиусы, тени — CSS-переменные из `app/globals.css`. Тёмная тема, фиолетово-синие акценты.
- Обязателен видимый `:focus-visible`, контраст текста ≥ 4.5:1, поддержка `prefers-reduced-motion`.
- Mobile-first, без горизонтальной прокрутки на ширине 320px.

## Безопасность и переменные окружения

- `OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY`, `OMNIROUTE_MODEL` — только серверные, без префикса `NEXT_PUBLIC_`.
- Секреты лежат в `.env.local` (в `.gitignore`); `.env.example` содержит только безопасные заглушки.
- Никогда не логировать и не возвращать клиенту значения ключей, заголовки авторизации или сырой ответ провайдера.
- Входящие данные валидируются: роли, типы, длина сообщения (≤ 1000 символов), длина истории (≤ 40 сообщений).

## Обработка ошибок

- Сервер возвращает `{ error: { code, message } }` с корректным статусом:
  400 — неверный запрос; 413 — слишком большой; 503 — OmniRoute не настроен/недоступен;
  502 — некорректный ответ модели/ошибка авторизации у шлюза; 504 — тайм-аут.
- Сообщения безопасные и понятные; клиент показывает их и даёт кнопку «Повторить» без потери диалога.
- Если ответ модели не прошёл проверку схемы — один повторный запрос, затем 502. Исправления не выдумываются.
- Данные модели сверяются с диалогом: слова должны встречаться в ответе, ошибки в итогах — в репликах ученика,
  цель без сценария — всегда `not_applicable`.

## Запреты

- Никаких фиктивных/статических ответов ИИ, mock-моделей или автоматического fallback на заглушку.
- Никаких поддельных голосовых функций: распознавание и озвучивание — только реальный Web Speech API.
  Браузерный синтез речи не называется «голосом модели».
- Не выдумывать API-контракты.

## Команды

```bash
npm install          # зависимости
npm run dev          # http://localhost:3000 (или следующий свободный порт)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # unit-тесты (node:test, без доп. зависимостей)
npm run build        # production-сборка
```

## Критерии готовности

- Интерфейс завершён и адаптивен; есть все состояния (загрузка, ошибка, пусто, нет микрофона).
- Текстовый диалог реально работает через OmniRoute; ИИ учитывает уровень, тему и историю.
- Исправления приходят от модели и проходят серверную валидацию.
- История и счётчики корректно обновляются; повтор после ошибки работает без дублей.
- Голос: реальный Web Speech API, корректная деградация без поддержки.
- `typecheck`, `lint`, `test`, `build` проходят; ключ отсутствует в `.next/static`.
- Нельзя заявлять, что что-то работает, без фактической проверки.

## Phase 3: изображения, скорость, редизайн (октябрь 2026)

### Контракты OmniRoute (проверены на omniroute@3.8.51 реальными запросами)

- Генерация: `POST {OMNIROUTE_BASE_URL}/images/generations` `{ model, prompt, n: 1, size: "1024x1024" }` →
  `data[0].b64_json` (или `data[0].url`). Байты проверяются по сигнатуре (`lib/imageMime.ts`), ≤ 8 МБ; URL — только
  публичный https, без редиректов. Поддерживают только провайдеры из реестра изображений OmniRoute
  (`open-sse/config/imageRegistry.ts`); DeepInfra туда не входит.
- Vision: обычный `chat/completions` с `content: [{type:"text"}, {type:"image_url", image_url:{url:"data:..."}}]` +
  `json_schema`. Изображение описывается ОДИН раз (`/api/image/describe`); в чат дальше идёт только текст описания
  (`imageContext`). Модель не «видит» картинку — так и пишем в UI и в промпте.
- Streaming: `stream: true` + `json_schema` отдаёт SSE с `delta.content`; поле `reply` идёт первым, его текст
  показывается заранее через `lib/partialJson.ts`, финальный объект всегда `JSON.parse` + валидация.
  У grok-cli один поток однажды завис → обязателен тайм-аут простоя (20 с), затем обычный запрос.

### Производительность

- Главная причина задержек — скрытые reasoning-токены (~1000–2700 на ответ). `OMNIROUTE_REASONING_EFFORT=low`
  + явная модель вместо `auto` + поток: медиана полного ответа 25.6 с → 7.2 с, первый текст ~4.5 с.
- В модель уходят последние `CHAT_CONTEXT_MESSAGES` (16) сообщений; сценарий, уровень и картинка — в system prompt.
- Тайм-ауты раздельные: текст 45 с, поток простой 20 с, vision 60 с, изображение 120 с, Cartesia 20 с.
- Повтор только при невалидном выводе модели. 401/402/403/404/429 не повторяются. Резервная модель
  (`OMNIROUTE_FALLBACK_MODEL`) — только при тайм-ауте/5xx и только если задана.
- Перевод и подсказки — на `OMNIROUTE_FAST_MODEL`; подсказки обычно уже есть в ответе чата (без запроса).

### Дизайн

- Токены в `app/globals.css` (`--panel`, `--glow-cta`, `--text-gradient`, `--border-accent`…). Новые компоненты
  используют их, а не «магические» цвета.
- Начальный экран: слева заголовок/преимущества/прогресс, справа панель «Новая сессия» с липким подвалом и главной
  кнопкой Start Speaking. Generate Image — в заголовке блока сценариев.

## Phase 4: доводка (октябрь 2026)

- TTS-приоритет: Cartesia → OmniRoute `/v1/audio/speech` (`OMNIROUTE_TTS_MODEL`/`OMNIROUTE_TTS_VOICE`) → браузер.
  Аудио проверяется по сигнатуре (`lib/audioMime.ts`). ElevenLabs Free: только стандартные голоса, Voice Library → 402.
- Мобильный экран (≤ 640 px): подвал «Новая сессия» — `position: fixed` с `env(safe-area-inset-bottom)`.
  У предка нельзя оставлять `backdrop-filter`/`transform`-анимацию: они делают его containing block для fixed.
  Viewport: `viewport-fit=cover`, `interactive-widget=resizes-content`.
- Качество промпта проверяется скриптом многоходовых диалогов (исправления цитируют реплику, нет дублей слов,
  итоги из истории, Image Talk не подтверждает отсутствующие детали). Промпт: без A1-слов для Beginner, без
  «исправлений» вариантов написания, без деталей вне описания картинки.
- Ручная проверка микрофона — `docs/VOICE_TEST_PLAN.md`.
