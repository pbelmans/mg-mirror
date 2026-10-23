.PHONY: data build serve check

data:
	python3 scripts/prepare_data.py

build: data
	hugo --minify --gc --cacheDir "$(CURDIR)/.cache/hugo" --destination .cache/pages

serve: data
	hugo server --bind 127.0.0.1 --disableFastRender

check:
	python3 scripts/check_site.py --public .cache/pages
