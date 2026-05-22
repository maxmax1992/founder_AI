PYTHON ?= python3
SOURCECTL ?= $(PYTHON) tools/wiki_sources.py

.PHONY: sources-list sources-active-paths sources-graphify-command sources-graphify wiki-help

wiki-help:
	@echo "Source commands:"
	@echo "  $(SOURCECTL) add <file-or-dir> --title \"Source title\" --advisor marten --tags founder-sprint"
	@echo "  $(SOURCECTL) list"
	@echo "  $(SOURCECTL) edit <source-id> --title \"New title\""
	@echo "  $(SOURCECTL) remove <source-id>"
	@echo "  $(SOURCECTL) restore <source-id>"
	@echo "  make sources-graphify"

sources-list:
	$(SOURCECTL) list

sources-active-paths:
	$(SOURCECTL) active-paths

sources-graphify-command:
	$(SOURCECTL) graphify-command

sources-graphify:
	graphify sources/active --update --wiki --obsidian --obsidian-dir wiki

