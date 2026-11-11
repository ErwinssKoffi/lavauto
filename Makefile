.PHONY: web build preview typecheck clean

web:            ## Serveur de développement (0.0.0.0:5173)
	npm run dev

build:          ## Vérification des types + build de production dans dist/
	npm run build

preview:        ## Sert le build de production
	npm run preview

typecheck:      ## Vérification TypeScript seule
	npx tsc -b --noEmit

clean:          ## Supprime le build
	rm -rf dist
