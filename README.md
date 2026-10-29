# Kibelki LOIII

Interaktywna mapa szkolnych toalet. Wersja dla Vercela korzysta z PostgreSQL
dostarczanego przez Neon.

## Wdrożenie na Vercel

1. Utwórz projekt PostgreSQL w Neon. Skopiuj connection string (może być
   pooled) i upewnij się, że jego rola może tworzyć tabele oraz indeksy.
2. Zaimportuj repozytorium `Olasty25/KibelkiLO3` w Vercel. Ustaw Root Directory
   na `./`, Framework Preset na `Other`, a Build Command i Output Directory
   pozostaw puste. Plik `index.html` jest serwowany statycznie, a `api/` Vercel
   uruchamia jako funkcje Node.js.
3. W ustawieniach projektu Vercel → **Environment Variables** dodaj:
   - `DATABASE_URL` — connection string z Neon,
   - `SESSION_SECRET` — losowa wartość co najmniej 32 bajtów, wygenerowana np.
     przez `openssl rand -base64 32`.

   Dodaj obie zmienne dla Production i Preview. Nie umieszczaj ich w kodzie,
   commitach ani zgłoszeniach. Zmiana zmiennych wymaga ponownego wdrożenia.
4. Wdróż produkcję (`Deploy` w panelu Vercel albo `vercel --prod`). Po wdrożeniu
   otwórz stronę i sprawdź, czy API odpowiada pod `/api/occupants`. Przy
   pierwszym żądaniu tabela `bathroom_presence` i jej indeks zostaną utworzone
   automatycznie.

### Uruchomienie lokalne

Zainstaluj Vercel CLI (`npm i -g vercel`), zaloguj się (`vercel login`) i
połącz katalog z projektem (`vercel link`). Pobierz zmienne środowiskowe z
projektu (`vercel env pull .env.local`), a następnie uruchom `vercel dev`.
Plik `.env.local` jest ignorowany przez Git. Alternatywnie skopiuj
`.env.example` do `.env.local` i uzupełnij obie zmienne ręcznie.

## Dane i prywatność

Aplikacja zapisuje pseudonimowy, losowy identyfikator sesji, wybraną ksywkę,
piętro i czas wpisu. Ksywka jest widoczna dla innych osób korzystających
z aplikacji, więc nie wpisuj danych, których nie chcesz ujawniać.
Aplikacja nie zapisuje zdjęć ani adresów IP. Zaznaczenie wygasa po 20 minutach
i jest usuwane z tabeli przy kolejnym żądaniu. Przeglądarka otrzymuje
podpisane ciasteczko `HttpOnly`, aby użytkownik mógł usunąć własny wpis.

Widok pokazuje bieżące obłożenie i odświeża się co 10 sekund.
Przed udostępnieniem osobom postronnym włącz ochronę dostępu do wdrożenia
Vercel i udostępniaj aplikację wyłącznie właściwej społeczności szkolnej.
Dostawca hostingu lub bazy może prowadzić własne techniczne logi zgodnie ze
swoimi ustawieniami i polityką prywatności.
